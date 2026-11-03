"""Herd Remote's Hermes coordinator host.

Runs one Hermes agent in-process whose only tools are the ones the bridge
sends in `start`. Every tool call is relayed to the bridge over stdout and
answered on stdin, so the bridge runs it against Herdr with its own guards.
Protocol: one JSON object per line (bridge/src/hermes/protocol.ts).

Run with Hermes's own virtualenv: `<hermes-agent>/venv/bin/python -I host.py`.
This file depends on Hermes internals (verified against Hermes 0.21.0); any
missing name is reported as `fatal` / `incompatible`, never worked around.
"""

import json
import os
import sys
import threading
import uuid

# Hermes replaces sys.stdout and newer versions also print progress straight to
# file descriptor 1. Keep a private copy of the pipe for the protocol (inherited
# if Hermes's bootstrap re-launches this process) and point fd 1 at /dev/null.
_fd = int(os.environ.get("HERD_HOST_OUT_FD", "-1"))
if _fd < 0:
    _fd = os.dup(1)
    os.set_inheritable(_fd, True)
    os.environ["HERD_HOST_OUT_FD"] = str(_fd)
_OUT = os.fdopen(_fd, "w", buffering=1)
_null = os.open(os.devnull, os.O_WRONLY)
os.dup2(_null, 1)
os.close(_null)
sys.stdout = open(os.devnull, "w")
_OUT_LOCK = threading.Lock()
# No user plugins, shell hooks, webhooks or configured MCP servers.
os.environ["HERMES_SAFE_MODE"] = "1"

HERMES_DIR = os.environ.get(
    "HERD_HERMES_DIR", os.path.expanduser("~/.hermes/hermes-agent")
)
TOOLSET = "herd_remote"
# Closes any request that did not finish cleanly (stopped, failed, cut off by a
# restart), so the model never carries it into the next message.
STOP_NOTE = "That request was stopped before it finished. Nothing more will be done for it."
PROBE_TOOLSET = "herd_remote_probe"  # registers nothing: the probe sends no tools
HISTORY_ITEMS = 200
RESULT_KEYS = ("agent_id", "title", "name", "status", "sent", "started", "ready", "uncertain", "first_task", "error")
TOOL_WAIT_SECONDS = 120


def emit(message):
    line = json.dumps(message, ensure_ascii=False)
    with _OUT_LOCK:
        _OUT.write(line + "\n")
        _OUT.flush()


try:
    sys.path.insert(0, HERMES_DIR)
    # Every Hermes entry point imports this first: newer Hermes keeps its
    # dependencies in a separate committed environment that this activates.
    try:
        import hermes_bootstrap  # noqa: F401
    except ModuleNotFoundError as missing:
        if missing.name != "hermes_bootstrap":
            raise
    from pathlib import Path

    import agent.title_generator as title_generator
    import tools.tool_search as tool_search
    from hermes_cli.config import load_config_readonly
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_state import SessionDB
    from run_agent import AIAgent
    from tools.registry import registry

    # Tool search would hide our tools behind tool_search/tool_call, and the
    # first turn would send an extra session-title request. Both are turned
    # off for this process only; the user's Hermes config is never written.
    _search_off = tool_search.ToolSearchConfig.from_raw({"enabled": "off"})
    tool_search.load_config = lambda: _search_off
    tool_search.load_config_readonly = lambda: _search_off
    title_generator._auto_title_enabled = lambda: False
except Exception as error:  # noqa: BLE001
    emit({"type": "fatal", "reason": "incompatible", "message": f"{type(error).__name__}: {error}"})
    sys.exit(1)


class Host:
    def __init__(self):
        self.db = None
        self.settings = None
        self.session_id = None
        self.agent = None
        self.turn_id = None
        self.turn_thread = None
        self.pending = {}
        self.pending_lock = threading.Lock()

    # ---- tools ------------------------------------------------------------

    def register_tools(self, specs):
        for spec in specs:
            name = spec["name"]
            registry.register(
                name=name,
                toolset=TOOLSET,
                schema={
                    "name": name,
                    "description": spec.get("description", ""),
                    "parameters": spec.get("parameters") or {"type": "object", "properties": {}},
                },
                handler=self.tool_handler(name),
            )

    def tool_handler(self, name):
        def handler(args, **_kwargs):
            call_id = uuid.uuid4().hex
            done = threading.Event()
            with self.pending_lock:
                self.pending[call_id] = {"event": done, "result": None}
            emit({
                "type": "tool_call",
                "turnId": self.turn_id,
                "callId": call_id,
                "name": name,
                "args": args if isinstance(args, dict) else {},
            })
            finished = done.wait(TOOL_WAIT_SECONDS)
            with self.pending_lock:
                entry = self.pending.pop(call_id, None)
            if not finished or not entry or entry["result"] is None:
                return json.dumps({"error": "The bridge did not answer this tool call in time."})
            ok, result = entry["result"]
            return result if ok else json.dumps({"error": result})

        return handler

    def tool_result(self, message):
        with self.pending_lock:
            entry = self.pending.get(message.get("callId"))
            if entry:
                entry["result"] = (bool(message.get("ok")), str(message.get("result", "")))
                entry["event"].set()

    # ---- agent ------------------------------------------------------------

    def runtime(self, settings):
        if settings.get("baseUrl"):
            return {
                "provider": settings["provider"],
                "api_mode": "chat_completions",
                "base_url": settings["baseUrl"],
                "api_key": settings.get("apiKey") or "none",
            }
        resolved = resolve_runtime_provider(
            requested=settings["provider"] or None, target_model=settings["model"] or None
        )
        return {
            "provider": resolved.get("provider"),
            "api_mode": resolved.get("api_mode"),
            "base_url": resolved.get("base_url"),
            "api_key": resolved.get("api_key"),
        }

    def build_agent(self, session_id, session_db, toolset=TOOLSET):
        settings = self.settings
        return AIAgent(
            model=settings["model"],
            enabled_toolsets=[toolset],
            quiet_mode=True,
            platform="cli",
            session_id=session_id,
            session_db=session_db,
            ephemeral_system_prompt=settings["instructions"],
            reasoning_config={"effort": settings.get("reasoningEffort", "medium"), "enabled": True},
            skip_context_files=True,
            skip_memory=True,
            stream_delta_callback=self.on_delta,
            **self.runtime_settings,
        )

    def on_delta(self, delta):
        if delta and self.turn_id:
            emit({"type": "delta", "turnId": self.turn_id, "text": delta})

    def probe(self):
        """One tool-less request with the chosen model, nothing persisted."""
        agent = self.build_agent("herd-remote-probe-" + uuid.uuid4().hex[:8], None, PROBE_TOOLSET)
        try:
            result = agent.run_conversation("Reply with OK.")
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "modelMissing": model_missing(str(error))}
        error = result.get("error")
        if error:
            return {"ok": False, "modelMissing": model_missing(str(error))}
        return {"ok": True, "modelMissing": False}

    def history(self):
        messages = self.db.get_messages_as_conversation(self.session_id, repair_alternation=True)
        return to_history(messages)[-HISTORY_ITEMS:]

    def close_unfinished(self, session_id):
        """End the session on a closed request: a turn cut off by a restart or a
        crash leaves a user message or tool rows with no final answer."""
        messages = self.db.get_messages_as_conversation(session_id, repair_alternation=True)
        if not messages:
            return
        last = messages[-1]
        finished = (
            last.get("role") == "assistant"
            and not last.get("tool_calls")
            and content_text(last.get("content")).strip()
        )
        if not finished:
            self.db.append_message(session_id, "assistant", STOP_NOTE)

    def ready(self, probe):
        default_model, default_provider = configured_default()
        emit({
            "type": "ready",
            "sessionId": self.session_id,
            "tools": sorted(self.agent.valid_tool_names),
            "history": self.history(),
            "defaultModel": default_model,
            "defaultProvider": default_provider,
            "probe": probe,
        })

    # ---- messages ---------------------------------------------------------

    def start(self, message):
        if not message.get("model"):
            # No model chosen by the bridge: Hermes's own configured default.
            default_model, default_provider = configured_default()
            message = {**message, "model": default_model or "", "provider": default_provider or ""}
        self.settings = message
        self.register_tools(message.get("tools") or [])
        try:
            self.runtime_settings = self.runtime(message)
        except Exception as error:  # noqa: BLE001
            emit({"type": "fatal", "reason": "signed_out", "message": str(error)[:500]})
            sys.exit(1)
        home = Path(os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes"))
        self.db = SessionDB(db_path=home / "state.db")
        self.session_id = message.get("sessionId") or new_session_id()
        self.close_unfinished(self.session_id)
        self.agent = self.build_agent(self.session_id, self.db)
        probe = self.probe() if message.get("probe") else None
        self.ready(probe)

    def new_session(self):
        self.session_id = new_session_id()
        self.agent = self.build_agent(self.session_id, self.db)
        self.ready(None)

    def turn(self, message):
        # Busy until the previous turn has closed its request and said so; its
        # thread may still be returning after turn_end, which is harmless.
        if self.turn_id is not None:
            emit({"type": "turn_end", "turnId": message["turnId"], "text": "",
                  "interrupted": False, "error": "Hermes is still answering."})
            return
        self.turn_id = message["turnId"]
        self.turn_thread = threading.Thread(
            target=self.run_turn, args=(message["turnId"], message["text"]), daemon=True
        )
        self.turn_thread.start()

    def run_turn(self, turn_id, text):
        text_out, interrupted, error = "", False, None
        session_id, agent = self.session_id, self.agent
        try:
            self.close_unfinished(session_id)
            history = self.db.get_messages_as_conversation(session_id, repair_alternation=True)
            result = agent.run_conversation(text, conversation_history=history)
            interrupted = bool(result.get("interrupted"))
            error = result.get("error") or None
            text_out = "" if error else (result.get("final_response") or "").strip()
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"[:500]
        if interrupted or error:
            # The model must see the request as closed in later turns, even
            # after a partial reply.
            try:
                self.db.append_message(session_id, "assistant", STOP_NOTE)
            except Exception:  # noqa: BLE001
                pass
        # Only now may the next turn start: its history must include the note.
        self.turn_id = None
        emit({"type": "turn_end", "turnId": turn_id, "text": text_out,
              "interrupted": interrupted, "error": str(error)[:500] if error else None})

    def cancel(self, message):
        if self.turn_id and message.get("turnId") == self.turn_id:
            # Pending tool calls still get the bridge's real answer, so Hermes
            # records what actually happened before it stops.
            self.agent.hard_interrupt()


def configured_default():
    """Hermes's configured default model and provider, read-only."""
    try:
        model = (load_config_readonly() or {}).get("model")
    except Exception:  # noqa: BLE001
        return None, None
    if isinstance(model, dict):
        return model.get("default") or None, model.get("provider") or None
    if isinstance(model, str):
        return model or None, None
    return None, None


def new_session_id():
    return "herd-remote-" + uuid.uuid4().hex[:16]


def model_missing(text):
    lowered = text.lower()
    return ("404" in lowered or "model_not_found" in lowered) and "model" in lowered


def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def summarize_result(text):
    """Only what the bridge needs for chips: reads can be 24 KiB each."""
    try:
        value = json.loads(text)
    except ValueError:
        return json.dumps({"error": text[:200]}) if text.startswith("{\"error") else text[:200]
    if not isinstance(value, dict):
        return json.dumps({"items": len(value)}) if isinstance(value, list) else text[:200]
    kept = {}
    for key in RESULT_KEYS:
        if key in value:
            item = value[key]
            kept[key] = item[:200] if isinstance(item, str) else item
    return json.dumps(kept)


def to_history(messages):
    """Hermes's OpenAI-style rows → one user item and one hermes item per exchange."""
    items = []
    calls = {}
    for row in messages:
        role = row.get("role")
        if role == "user":
            items.append({"role": "user", "text": content_text(row.get("content")),
                          "tools": [], "stopped": False})
            continue
        if not items or items[-1]["role"] != "hermes":
            items.append({"role": "hermes", "text": "", "tools": [], "stopped": False})
        reply = items[-1]
        if role == "assistant":
            for call in row.get("tool_calls") or []:
                function = call.get("function") or {}
                try:
                    args = json.loads(function.get("arguments") or "{}")
                except ValueError:
                    args = {}
                tool = {"name": function.get("name", ""),
                        "args": args if isinstance(args, dict) else {}, "result": ""}
                reply["tools"].append(tool)
                calls[call.get("id")] = tool
            text = content_text(row.get("content")).strip()
            if text:
                reply["text"] = text
        elif role == "tool":
            tool = calls.get(row.get("tool_call_id"))
            if tool is not None:
                tool["result"] = summarize_result(content_text(row.get("content")))
    for item in items:
        if item["role"] == "hermes" and item["text"].endswith(STOP_NOTE):
            item["stopped"] = True
            item["text"] = item["text"][: -len(STOP_NOTE)].strip()
    return items


def main():
    host = Host()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        kind = message.get("type")
        try:
            if kind == "start":
                host.start(message)
            elif kind == "turn":
                host.turn(message)
            elif kind == "cancel":
                host.cancel(message)
            elif kind == "tool_result":
                host.tool_result(message)
            elif kind == "new":
                host.new_session()
        except (AttributeError, ImportError, TypeError) as error:
            emit({"type": "fatal", "reason": "incompatible", "message": f"{type(error).__name__}: {error}"[:500]})
            sys.exit(1)
        except Exception as error:  # noqa: BLE001
            emit({"type": "fatal", "reason": "other", "message": f"{type(error).__name__}: {error}"[:500]})
            sys.exit(1)
    os._exit(0)


if __name__ == "__main__":
    main()
