# Hermes Coordinator Chat (stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hermes conversation per paired computer in Herd Remote that can list, read, message and start the computer's Herdr agents, with bridge-enforced send guards.

**Architecture:** The bridge runs a small Python host (`bridge/hermes/host.py`) under Hermes's own virtualenv. The host builds a Hermes `AIAgent` whose only tools are four tools it registers in Hermes's registry; each tool call is relayed over the host's stdio (JSON lines) to the bridge, which executes it against Herdr with the send guards and records chips. The bridge exposes the conversation over GraphQL; the app adds a pinned home row and a chat screen. Hermes's ACP mode is not used: it always enables Hermes's own terminal/file/browser toolset and folds stopped prompts into the next one (see the spec's "Coordinate only" and "A stopped request is gone").

**Tech Stack:** Node 22 ESM + TypeScript strict (bridge), graphql-yoga, vitest; Python 3.11 from `~/.hermes/hermes-agent/venv` (host, Hermes 0.21.0 internals); Expo 57 / React Native / Apollo Client 4 (app).

**Spec:** `docs/superpowers/specs/2026-11-03-hermes-coordinator-design.md` (stage 1 only; calls are a separate plan after the phone spike).

## Global Constraints

- Hermes only coordinates: the coordinator's tool list is exactly `list_agents`, `read_agent`, `send_to_agent`, `start_agent`; the bridge refuses to start it otherwise.
- Send guards (bridge-enforced): at most **3** agents messaged or started per user message; sends/starts refused unless a user turn is in progress; a stopped request never happens later; every send/start is recorded by the bridge and shown as a chip regardless of Hermes's text.
- Model: Codex's `model` from `~/.codex/config.toml` (currently `gpt-6.1-sol`) via Hermes's `openai-codex` provider, reasoning effort `medium`; visible fallback to Hermes's own default model when Codex's model isn't usable ("gpt-5.6-sol · codex's gpt-6.1-sol isn't available in hermes"). The user's Hermes config is never written.
- No automatic retries of Herdr mutations; uncertain delivery is reported, never resent. Opaque Herdr IDs only, `focus: false` everywhere, never an implicitly focused target.
- No conversation text, prompts, agent output or credentials in logs, commits or bridge files. Bridge state in ignored `.local/` with mode 0600 holds only IDs and the verified model name.
- Hermes must not appear as a Herdr agent: strip every `HERDR_*` variable from the host's environment.
- Tests never message the user's real agents: mock socket, fake host, fake OpenAI-compatible model server, or a disposable named Herdr session. No real model calls in tests.
- App look: tokens from `mobile/src/components/ui.tsx` only (palette test), mono font, lowercase labels, radius 4; chat style A (bubbles). Older bridges keep working; new operations go on the compat test's needs-newer list.
- Version 0.6.0 (bridge package, root package, app `version`; Android `versionCode` 7).
- Before each commit: `npm run lint:fix`, `npm run typecheck`, `npm test`. Public files use example hosts, paths and project names; commits use the GitHub noreply email (5278570+nihey@users.noreply.github.com).

## Review Focus

1. **Hermes stalls mid-turn** (provider hang): the turn must end with an error after a turn timeout (10 min) and the app must leave "working". Test in Task 5.
2. **Bridge restarts mid-turn:** the reloaded conversation's last user message with no reply shows as stopped, and nothing from it runs. Test in Task 5 (history mapping) and Task 3 (stop note in history).
3. **Agent closed between list and send:** `send_to_agent` returns the Herdr error as a tool error and records no "sent" chip. Test in Task 4.
4. **Huge agent output:** `read_agent` clips to the last 200 lines and 24 KiB. Test in Task 4.
5. **Two senders at once** (two phones, or a stale request): the second gets `hermes_busy`. Test in Task 5.

---

### Task 1: Spike — verify Hermes's Python API (throwaway)

**Files:** scratch only: `$SCRATCH/hermes-host-spike/` (the session scratchpad). Nothing committed.

**Interfaces:**
- Produces: ledger lines `Task 1: fact: …` naming the exact verified API that Task 3 uses. Task 3's host must use only names recorded here.

Run everything with `~/.hermes/hermes-agent/venv/bin/python -I`, `HERMES_HOME` set to a fresh temp dir, every `HERDR_*` variable unset, against a fake OpenAI-compatible server written in the scratch dir (Node `http`, scripted responses). No real provider calls, no `herdr`, no writes to `~/.hermes`.

- [ ] **Step 1: Answer each question with a script run, and ledger the answer**

  a. `AIAgent` construction with an explicit custom provider (`base_url` = fake server, `api_key` = dummy, `model` = `fake-model`): exact kwargs for model/provider/api_mode/base_url/api_key, the system-prompt parameter (ephemeral or persistent), `reasoning_config` value for medium effort, `stream_delta_callback`, `tool_start_callback`/`tool_complete_callback`, `session_id` + `SessionDB`, `quiet_mode`, `platform`.
  b. `tools.registry.registry.register(name=…, toolset='herd_remote', schema=…, handler=…)` for four tools, then `enabled_toolsets=['herd_remote']`: does `agent.valid_tool_names` (or the verified equivalent) equal exactly the four names? Repeat with `HERMES_SAFE_MODE=1`; record which setting gives exactly four and whether safe mode breaks anything needed (sessions, provider resolution).
  c. `run_conversation(...)`: exact signature and return keys; whether it persists the user message and reply to `SessionDB`; `hard_interrupt()` from another thread mid-stream: what it returns (`interrupted`), and whether the partial reply is persisted.
  d. Reload: `SessionDB(...).get_messages_as_conversation(session_id, repair_alternation=True)` shape (roles, tool calls with arguments, tool results).
  e. Fake server needs: does Hermes stream (`stream: true`, SSE chunks) for a custom provider? The minimal response shapes for a text reply and for one tool call.
  f. A model error: fake server returns HTTP 404 `{"error":{"code":"model_not_found"}}`. What does `run_conversation` raise or return? Record the string/attribute that identifies it.
  g. How to read Hermes's configured default model and provider through Hermes's own config loader (function name), and how `resolve_runtime_provider(requested='openai-codex')` returns credentials without network (inspect only; do not call the provider).
  h. Agent construction time (ms) with the fake provider.

- [ ] **Step 2: Decide**

If (b) cannot produce exactly four tools by any combination, stop and ask the user (spec requirement cannot be met as designed). Otherwise ledger `Task 1: Ruling: host API = …` with the chosen combination.

---

### Task 2: Shared Herdr actions (refactor, no behavior change)

**Files:**
- Create: `bridge/src/actions.ts`
- Modify: `bridge/src/schema.ts` (resolvers call actions)
- Test: `bridge/src/server.test.ts` (unchanged; must stay green)

**Interfaces:**
- Produces:
  ```ts
  export type Snapshot = { workspaces?: RecordValue[]; panes?: RecordValue[]; agents?: RecordValue[] } & RecordValue;
  export function createActions(request: RequestHerdr, timing: StartTiming, homeDir: string): {
    call(method: string, params?: RecordValue, timeoutMs?: number): Promise<RecordValue>; // GraphQLError on failure, as today
    snapshot(): Promise<Snapshot>;
    readOutput(target: string, options: { source: 'RECENT' | 'VISIBLE'; lines: number; raw: boolean }): Promise<string>;
    prompt(target: string, text: string): Promise<void>;
    startSession(args: { workspaceId: string | null; name: string; kind: string }): Promise<StartedSession>;
    startTerminal(workspaceId: string | null): Promise<StartedTerminal>;
  };
  ```
  `RequestHerdr`, `StartTiming`, `HOME_WORKSPACE_LABEL`, the validators (`target`, `text`, `agentName`, `agentKind`) move to `actions.ts` and are re-exported from `schema.ts` where tests import them.

- [ ] **Step 1: Move the helpers and resolver bodies into `createActions`; resolvers become one-line calls.** Error codes, messages and extensions stay byte-identical.
- [ ] **Step 2: Run** `npm test -- bridge` — Expected: same pass count as before the move, 0 failures.
- [ ] **Step 3: Commit** `refactor(bridge): share Herdr actions between GraphQL and Hermes tools`

---

### Task 3: Python host and its stdio client

**Files:**
- Create: `bridge/hermes/host.py` (outside `src/` so `new URL('../hermes/host.py', import.meta.url)` resolves from both `src/` and `dist/`)
- Create: `bridge/src/hermes/protocol.ts`, `bridge/src/hermes/host.ts`
- Create (test util): `bridge/src/hermes/fake-model.ts` — fake OpenAI-compatible server shaped by Task 1(e)
- Test: `bridge/src/hermes/host.test.ts`

**Interfaces:**
- Consumes: Task 1 facts.
- Produces (`protocol.ts`):
  ```ts
  export type HistoryTool = { name: string; args: Record<string, unknown>; result: string };
  export type HistoryItem = { role: 'user' | 'hermes'; text: string; tools: HistoryTool[]; stopped: boolean };
  export type HostIn =
    | { type: 'start'; sessionId: string | null; model: string; provider: string; baseUrl?: string; apiKey?: string; reasoningEffort: 'medium'; instructions: string; probe: boolean }
    | { type: 'turn'; turnId: string; text: string }
    | { type: 'cancel'; turnId: string }
    | { type: 'tool_result'; callId: string; ok: boolean; result: string }
    | { type: 'new' };
  export type HostOut =
    | { type: 'ready'; sessionId: string; tools: string[]; history: HistoryItem[]; defaultModel: string | null; defaultProvider: string | null; probe: { ok: boolean; modelMissing: boolean } | null }
    | { type: 'delta'; turnId: string; text: string }
    | { type: 'tool_call'; turnId: string; callId: string; name: string; args: Record<string, unknown> }
    | { type: 'turn_end'; turnId: string; text: string; interrupted: boolean; error: string | null }
    | { type: 'fatal'; reason: 'signed_out' | 'incompatible' | 'other'; message: string };
  ```
  (`host.ts`):
  ```ts
  export type HermesHost = { send(message: HostIn): void; onMessage(listener: (message: HostOut) => void): void; onExit(listener: (code: number | null) => void): void; stop(): void };
  export function spawnHost(options: { python: string; script?: string; env?: NodeJS.ProcessEnv }): HermesHost;
  ```
  `spawnHost` removes every `HERDR_*` key from the env, passes `-I`, drops stderr (never logged), parses stdout as JSON lines with a 4 MiB line cap (over-long or invalid line → `fatal` `other`, process killed).
- Host behavior: one agent per session; tools registered in toolset `herd_remote` with the schemas from Task 4; a tool handler writes `tool_call` and blocks (max 120 s, then returns `{"error":"timeout"}` to Hermes) until the matching `tool_result`; one turn at a time; `cancel` calls `hard_interrupt()`. After an interrupted turn the host appends and persists the assistant note `Stopped by the user. Nothing more will be done for that request.` so the model sees the request as closed. `probe: true` runs one tool-less completion `Reply with OK.` with the requested model before `ready`; a model-not-found (Task 1(f)) sets `modelMissing: true`. Provider resolution failure for `openai-codex` → `fatal` `signed_out`. Import or attribute errors from Hermes internals → `fatal` `incompatible` with the missing name.

Tests are skipped (`describe.skipIf`) when `~/.hermes/hermes-agent/venv/bin/python` is missing. Each runs the real host with `HERMES_HOME` = fresh temp dir and the fake model.

- [ ] **Step 1: Write the failing tests** in `host.test.ts`:
  - `reports exactly the four coordinator tools` → `ready.tools` sorted equals `['list_agents','read_agent','send_to_agent','start_agent']`.
  - `relays a tool call and streams the reply` → fake model scripts a `list_agents` call then text `two agents`; the test answers `tool_result` with `[]`; expect a `tool_call` with `name: 'list_agents'`, at least one `delta`, and `turn_end.text === 'two agents'`.
  - `stops a turn and closes the request in history` → fake model streams slowly; `cancel` mid-stream; expect `turn_end.interrupted === true`; the next turn's request body received by the fake model contains `Stopped by the user.`
  - `reloads a session's history` → after one turn, restart the host with the same `sessionId`; `ready.history` equals `[{role:'user',…},{role:'hermes',…}]` with the turn's text and its tool (`name`, `args`, `result`).
  - `flags a missing model on probe` → fake model returns the 404; `ready.probe` equals `{ ok: false, modelMissing: true }`.
  - `strips Herdr variables` (runs without Hermes) → `hostEnv({ HERDR_ENV: '1', HERDR_PANE_ID: 'x', PATH: 'p' })` equals `{ PATH: 'p' }`; `hostEnv` is exported from `host.ts` and is what `spawnHost` uses.
- [ ] **Step 2: Run** `npx vitest run bridge/src/hermes/host.test.ts` — Expected: FAIL (module/host missing).
- [ ] **Step 3: Implement** `host.py`, `protocol.ts`, `host.ts`, `fake-model.ts` using only Task 1's verified names.
- [ ] **Step 4: Run** the same command — Expected: 6 passed.
- [ ] **Step 5: Commit** `feat(bridge): run Hermes in a host limited to the coordinator tools`

---

### Task 4: The four tools and the send guards

**Files:**
- Create: `bridge/src/hermes/tools.ts`
- Test: `bridge/src/hermes/tools.test.ts`

**Interfaces:**
- Consumes: `createActions` (Task 2).
- Produces:
  ```ts
  export const TOOL_NAMES = ['list_agents', 'read_agent', 'send_to_agent', 'start_agent'] as const;
  export const TOOL_SCHEMAS: Record<(typeof TOOL_NAMES)[number], object>; // OpenAI function JSON schemas, sent to the host in `start`
  export const CHANGES_PER_TURN = 3;
  export type Chip = { kind: 'read' | 'sent' | 'started'; paneId: string; title: string | null };
  export type Turn = { id: string; changes: number };
  export function createTools(actions: ReturnType<typeof createActions>, newName: (kind: string) => string): {
    run(turn: Turn | null, name: string, args: unknown): Promise<{ ok: boolean; result: string; chip?: Chip }>;
  };
  ```
  Tool contracts (results are JSON text for the model):
  - `list_agents()` → `[{ agent_id, title, project, folder, kind, status }]` (agents only; `agent_id` = pane ID).
  - `read_agent({ agent_id, lines? = 120 })` → `{ title, status, text }`, `text` clipped to the last 200 lines and 24 KiB; chip `read`.
  - `send_to_agent({ agent_id, message })` → `agent.prompt` once; chip `sent`; counts as a change.
  - `start_agent({ project?, kind? = 'claude', first_task? })` → project matched case-insensitively on workspace label (no match → error listing open projects; omitted → home workspace); `startSession` with `newName(kind)`; `first_task` sent once only when `ready`, otherwise result says it was not sent; chip `started`; counts as one change.
  - Refusals (ok false, no chip, no Herdr call): unknown tool; bad args; `send_to_agent`/`start_agent` with `turn === null` → `"Messages and new agents only happen while answering the user."`; a 4th change in a turn → `"I can message or start at most 3 agents per request."`. Herdr errors → ok false with the message and code; `delivery_unknown` says it may have been delivered and must not be resent.

- [ ] **Step 1: Write the failing tests** (mock `request` like `server.test.ts`):
  - `lists agents with opaque ids` → result parses to entries with `agent_id: 'w1:p1'`, `title`, `project`, `status`.
  - `clips long agent output` → 1000-line output → returned `text` has ≤ 200 lines and ≤ 24576 bytes and ends with the last line.
  - `sends once and records a chip` → one `agent.prompt` call with `{ target: 'w1:p1', text }`; `chip` equals `{ kind: 'sent', paneId: 'w1:p1', title: … }`.
  - `refuses a fourth change in one turn` → three sends ok, fourth ok false with the 3-agent message and no 4th `agent.prompt`.
  - `refuses sends outside a user turn` → `run(null, 'send_to_agent', …)` ok false; no socket call.
  - `reports a closed agent without a chip` → `agent.prompt` fails `agent_not_found` → ok false, no `chip`.
  - `never resends on uncertain delivery` → `delivery_unknown` → ok false, result mentions it may have arrived, exactly one `agent.prompt`.
  - `starts an agent in a named project and sends its first task once` → `tab.create` in the matched workspace with `focus: false`, `agent.start`, then one `agent.prompt`; chip `started`.
  - `starts in the home workspace when no project is named` → workspace `phone` used.
- [ ] **Step 2: Run** `npx vitest run bridge/src/hermes/tools.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `tools.ts`.**
- [ ] **Step 4: Run** — Expected: 9 passed.
- [ ] **Step 5: Commit** `feat(bridge): coordinator tools with send guards`

---

### Task 5: The coordinator

**Files:**
- Create: `bridge/src/hermes/coordinator.ts`, `bridge/src/hermes/model.ts`
- Test: `bridge/src/hermes/coordinator.test.ts`, `bridge/src/hermes/model.test.ts`

**Interfaces:**
- Consumes: `HermesHost`/`HostIn`/`HostOut` (Task 3), `createTools`/`Chip`/`TOOL_SCHEMAS` (Task 4).
- Produces:
  ```ts
  // model.ts
  export function codexModel(toml: string): string | null; // top-level `model = "…"` before any [table]
  // coordinator.ts
  export type ConversationMessage = { id: string; role: 'user' | 'hermes'; text: string; chips: Chip[]; stopped: boolean; at: string };
  export type Conversation = { status: 'starting' | 'ready' | 'unavailable'; reason: string | null; model: string | null; modelNote: string | null; working: boolean; messages: ConversationMessage[] };
  export function createCoordinator(options: {
    spawn: () => HermesHost | null;           // null: Hermes not installed
    tools: ReturnType<typeof createTools>;
    stateFile: string;                        // .local/hermes-state.json, mode 0600: { sessionId, verifiedModel }
    readCodexConfig: () => string | null;
    instructions: string;
    turnTimeoutMs?: number;                   // default 600000
    now?: () => Date;
  }): {
    conversation(): Conversation;             // starts the host lazily
    send(text: string): string;               // turn id; throws CoordinatorError('hermes_busy' | 'hermes_unavailable')
    stop(): void;
    reset(): Promise<void>;
    close(): void;
  };
  export class CoordinatorError extends Error { constructor(readonly code: string, message: string) }
  export const COORDINATOR_INSTRUCTIONS: string; // spec "Instructions" + send-guard guidance
  ```
  Model choice: Codex model with provider `openai-codex`; `probe: true` unless it equals `verifiedModel`. On `probe.modelMissing` restart with `ready.defaultModel`/`defaultProvider` and set `modelNote` to `<fallback> · codex's <codex model> isn't available in hermes`. No Codex config → Hermes default, no note.
  Status reasons: not installed → `Hermes isn't installed on this computer.`; `fatal signed_out` → `Hermes isn't signed in to OpenAI Codex on this computer. Run hermes login there.`; `incompatible` → `This Hermes version isn't supported yet (<message>).`; tool list ≠ `TOOL_NAMES` → unavailable `Hermes offered tools beyond the four coordinator tools; refusing to start.` and the host is stopped. Host exit → unavailable with a restart on the next `conversation()` after 30 s.
  Turns: `send` while working → `hermes_busy`; each `tool_call` runs through `tools.run(currentTurn, …)` and its chip is appended to the current reply; `delta` grows the reply text; `turn_end` closes it (`interrupted` → `stopped: true`). History from `ready` maps tools back to chips (`read_agent`→read, `send_to_agent`→sent, `start_agent`→started, only when the recorded result was ok); a trailing user message with no reply maps to `stopped: true`.

- [ ] **Step 1: Write the failing tests** (fake `HermesHost` in the test, scripted `HostOut`):
  - `model.test.ts`: `reads codex's top-level model` → `codexModel('model = "gpt-6.1-sol"\n[profiles.x]\nmodel = "o"')` === `'gpt-6.1-sol'`; `ignores models inside tables` → `'[a]\nmodel = "x"'` → `null`.
  - `starts Hermes with codex's model at medium effort` → first `start` has `model: 'gpt-6.1-sol'`, `provider: 'openai-codex'`, `reasoningEffort: 'medium'`, `probe: true`.
  - `falls back visibly when codex's model is missing` → `probe.modelMissing` → second `start` uses `defaultModel`; `conversation().modelNote` === `"gpt-5.6-sol · codex's gpt-6.1-sol isn't available in hermes"`.
  - `refuses a host with extra tools` → `ready.tools` includes `terminal` → status `unavailable`, host `stop()` called.
  - `rejects a second message while working` → `send` twice → second throws code `hermes_busy`.
  - `shows sends as chips from the bridge's record` → host emits `tool_call send_to_agent`; the reply's chips contain `{kind:'sent'}` even though `turn_end.text` never mentions it.
  - `stop marks the reply stopped` → `stop()` sends `cancel`; `turn_end interrupted` → last message `stopped: true`, `working: false`.
  - `ends a stalled turn` → `turnTimeoutMs: 50`, no `turn_end` → after 50 ms `working: false`, reply `stopped: true`, `cancel` sent.
  - `maps reloaded history to messages and chips` → `ready.history` with a trailing user item → messages with chips; last `stopped: true`.
  - `remembers the session` → after `ready`, `stateFile` contains `sessionId` and mode is `0o600`; a new coordinator's first `start` carries that `sessionId`.
  - `reports a missing Hermes` → `spawn` returns null → `unavailable`, reason `Hermes isn't installed on this computer.`
- [ ] **Step 2: Run** `npx vitest run bridge/src/hermes` — Expected: new tests FAIL.
- [ ] **Step 3: Implement `model.ts` and `coordinator.ts`.**
- [ ] **Step 4: Run** — Expected: all `bridge/src/hermes` tests pass.
- [ ] **Step 5: Commit** `feat(bridge): Hermes coordinator conversation with model fallback`

---

### Task 6: GraphQL API and bridge wiring

**Files:**
- Modify: `bridge/src/schema.ts`, `bridge/src/server.ts`, `bridge/src/index.ts`, `bridge/src/config.ts`
- Test: `bridge/src/server.test.ts`

**Interfaces:**
- Consumes: `createCoordinator` (Task 5).
- Produces (SDL added to the schema string):
  ```graphql
  enum HermesStatus { STARTING READY UNAVAILABLE }
  enum HermesRole { USER HERMES }
  enum HermesChipKind { READ SENT STARTED }
  type HermesChip { kind: HermesChipKind! paneId: ID! title: String }
  type HermesMessage { id: ID! role: HermesRole! text: String! chips: [HermesChip!]! stopped: Boolean! at: String! }
  type Hermes { status: HermesStatus! reason: String model: String modelNote: String working: Boolean! messages(last: Int = 100): [HermesMessage!]! }
  # Query
  hermes: Hermes!
  # Mutation
  hermesSend(text: String!): ActionResult!
  hermesStop: ActionResult!
  hermesNew: ActionResult!
  ```
  Resolvers map the coordinator's lowercase values to the enums (`'read'`→`READ`, `'user'`→`USER`, `'starting'`→`STARTING`, …). `createBridge({ …, hermes?: Coordinator })`; without one, `hermes` is `UNAVAILABLE` with reason `Hermes is not set up on this bridge.` `hermesSend` text limit 16 KiB; `CoordinatorError` → `GraphQLError` with its code. `messages(last)` 1–200. `config.ts` adds `hermesPython` (`HERDR_MOBILE_HERMES_PYTHON`, default `~/.hermes/hermes-agent/venv/bin/python`; missing file → spawn returns null) and `hermesStateFile` (`../.local/hermes-state.json`). `index.ts` builds actions, tools and coordinator; name generator `${kind}-${4 hex}`; `close()` on shutdown.

- [ ] **Step 1: Write the failing tests** in `server.test.ts` (fake coordinator object):
  - `reports Hermes as unavailable when not set up` → `{ hermes { status reason } }` → `UNAVAILABLE`, reason as above.
  - `sends a message to Hermes` → `hermesSend(text:"hi")` → `ok: true`, coordinator `send('hi')` called once.
  - `reports a busy Hermes` → coordinator throws `hermes_busy` → error `extensions.code === 'hermes_busy'`.
  - `rejects oversized Hermes messages` → 17 KiB text → `BAD_USER_INPUT`, `send` not called.
  - `returns the last messages with chips` → `messages(last: 1)` returns only the newest, chip kind `SENT`.
  - `requires the token for Hermes` → no bearer → 401.
- [ ] **Step 2: Run** `npx vitest run bridge/src/server.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement the SDL, resolvers and wiring.**
- [ ] **Step 4: Run** `npm test` — Expected: all pass (the app compat test still passes: no app operation changed yet).
- [ ] **Step 5: Commit** `feat(bridge): Hermes conversation over GraphQL`

---

### Task 7: Integration against a disposable Herdr session

**Files:**
- Modify: `scripts/integration.ts`

**Interfaces:**
- Consumes: Tasks 3–6; the script's existing disposable session, `/bin/sh` panes and `codex` stand-in; `fake-model.ts`.

The fake model scripts Hermes's turns: (1) `list_agents` → reply; (2) `send_to_agent` to the stand-in with `HERMES_SEND_OK` → reply; (3) four `send_to_agent` calls in one turn; (4) `start_agent` with no project and `first_task` `HERMES_START_OK`. The coordinator runs the real host (skip this section with a printed notice when Hermes's Python is missing) with `HERMES_HOME` = temp dir and the fake provider.

- [ ] **Step 1: Add the checks:** turn 1 reply lists the stand-in's pane ID; after turn 2 the stand-in's output contains `received: HERMES_SEND_OK` exactly once; turn 3 delivers exactly 3 prompts and the 4th tool result is the 3-agent refusal; turn 4 opens a tab in the `phone` workspace and its output contains `received: HERMES_START_OK` once; `session.snapshot` shows no agent whose kind is `hermes`.
- [ ] **Step 2: Run** `npm run integration` — Expected: prints all checks OK and the existing checks still pass.
- [ ] **Step 3: Commit** `test: exercise the Hermes coordinator against a disposable Herdr session`

---

### Task 8: App operations and helpers

**Files:**
- Modify: `mobile/src/lib/graphql.ts`, `mobile/src/lib/types.ts`, `mobile/src/lib/bridge-compat.test.ts`
- Create: `mobile/src/lib/hermes.ts`, `mobile/src/lib/hermes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // graphql.ts
  export const HERMES;          // query Hermes { hermes { status reason model modelNote working messages(last: 100) { id role text stopped at chips { kind paneId title } } } }
  export const HERMES_SUMMARY;  // query HermesSummary { hermes { status reason working messages(last: 1) { id role text } } }
  export const HERMES_SEND;     // mutation HermesSend($text: String!) { hermesSend(text: $text) { ok } }
  export const HERMES_STOP;     // mutation HermesStop { hermesStop { ok } }
  export const HERMES_NEW;      // mutation HermesNew { hermesNew { ok } }
  // types.ts: HermesChip, HermesMessage, Hermes (mirroring the SDL)
  // hermes.ts
  export function chipLabel(chip: HermesChip, agent: Agent | undefined): string; // "read ✓ title" / "sent to ◐ title" / "started ○ title"; gone agent → "<verb> (closed) title"
  export function summaryLine(hermes: Pick<Hermes, 'status' | 'reason' | 'working' | 'messages'>): string; // working → "working…", unavailable → reason, else newest message's first line (≤ 80 chars), empty → "ask about your agents"
  export function reportUrl(text: string, address: string): string; // mailto:, subject "Herd Remote: report a Hermes reply", body = reply clipped to 2000 chars, URI-encoded
  export const REPORT_ADDRESS: string;
  ```
  Compat test: replace `needs050` with `needsNewer = ['HOME_FOLDER','START_TERMINAL','START_HOME_SESSION','HERMES','HERMES_SUMMARY','HERMES_SEND','HERMES_STOP','HERMES_NEW']`.

- [ ] **Step 1: Write the failing tests** in `hermes.test.ts`: `labels a send with the agent's status mark` → `chipLabel({kind:'SENT',paneId:'p',title:'Payments migration'}, {status:'working',…})` === `'sent to ◐ Payments migration'`; `labels a closed agent` → undefined agent → `'read (closed) Payments migration'`; `summarizes a working Hermes` → `'working…'`; `summarizes with the newest line` → first line only, clipped to 80 chars with `…`; `builds a report email` → starts with `mailto:`, decodes back to the clipped body, never longer than 2000 chars of reply.
- [ ] **Step 2: Run** `npx vitest run mobile/src/lib` — Expected: FAIL (hermes.ts missing); compat test FAILS for the new ops against 0.4.0 until listed.
- [ ] **Step 3: Implement**; set `REPORT_ADDRESS` to the address the user confirmed at plan review.
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): Hermes operations and chat helpers`

---

### Task 9: Hermes chat screen

**Files:**
- Create: `mobile/src/screens/HermesScreen.tsx`, `mobile/src/app/hermes.tsx`

**Interfaces:**
- Consumes: Task 8 operations/helpers; `usePoll`, `useSnapshot`, `useDictation`/`DictationControl`, `errorMessage`, ui tokens.

Behavior (spec "The screens" + "The conversation"):
- Route `hermes.tsx` takes `machineId`; mismatch with the active profile → `<Redirect href="/" />` (same as the agent route). Keyed by machine.
- Header `✦ hermes`, subtitle `coordinates your agents · <machine>` (plus `modelNote` when set), **new** button (confirm Sheet → `HERMES_NEW`). The call button is not added in stage 1.
- Messages: user bubbles right (`c.elevated`), Hermes bubbles left (`c.panel` + `c.line` border), radius 8 with the 2 px tail corner; a stopped reply shows `stopped` in `c.dim`. Chips between bubbles via `chipLabel`; tapping a live agent's chip opens `/agent/[paneId]` with `machineId`; closed chips are not pressable. Long-press a Hermes bubble → Sheet with **report this reply** → `Linking.openURL(reportUrl(text, REPORT_ADDRESS))`.
- Composer: field `ask or tell hermes…`, dictation control (fills the draft only), **send**; while `working` the button is **stop** (`HERMES_STOP`). Send failure: daemon error → notice, draft kept; network failure → `errorMessage(error, true)` notice, draft kept, conversation refreshed, never resent.
- Polling `HERMES` every 1000 ms while working, 4000 ms otherwise; follows the bottom like the agent screen; KeyboardAvoidingView `padding`.
- Unavailable/outdated: `isOutdated(error)` → "update the bridge on this computer" notice; `UNAVAILABLE` → reason notice; composer disabled.

- [ ] **Step 1: Implement** the screen and route.
- [ ] **Step 2: Run** `npm run lint:fix && npm run typecheck && npm test` — Expected: clean, all pass (palette test included).
- [ ] **Step 3: Commit** `feat(app): Hermes chat screen`

---

### Task 10: Pinned Hermes row on home

**Files:**
- Create: `mobile/src/screens/HermesRow.tsx`
- Modify: `mobile/src/screens/AgentsScreen.tsx`

Behavior: first row above the counters, `✦ hermes` in `c.accent`, `summaryLine(...)` below in `c.muted`, `◐` when working; polls `HERMES_SUMMARY` every 5000 ms (own `usePoll`, so a failure never affects the agent list); tap → `/hermes` with `machineId`. Outdated bridge → the row shows "update the bridge on this computer to use hermes" and is not pressable; `UNAVAILABLE` → the reason, still pressable (the chat explains).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm run lint:fix && npm run typecheck && npm test` — Expected: clean, all pass.
- [ ] **Step 3: Commit** `feat(app): pin Hermes on the home screen`

---

### Task 11: Release 0.6.0, docs, privacy and checks

**Files:**
- Modify: `package.json`, `bridge/package.json`, `mobile/package.json`, `mobile/app.json` (0.6.0, versionCode 7), `README.md`, `AGENTS.md`, `bridge/AGENTS.md`, `mobile/AGENTS.md`, `PRIVACY.md`, `docs/verification.md`, `docs/implementation-ledger.md`

- [ ] **Step 1: Docs.** AGENTS files: the host architecture, guards, tool list check, state file, env stripping, GraphQL ops, compat list. README: Hermes setup (installed Hermes, Codex sign-in, `HERDR_MOBILE_HERMES_PYTHON`), what Hermes can do. PRIVACY.md: when Hermes is used, the user's messages and what Hermes reads from agents go to the Hermes model provider configured on the computer (OpenAI through the user's Codex sign-in by default); nothing is sent unless the user uses Hermes; audio unaffected; new effective date.
- [ ] **Step 2: Verify on the tablet emulator** (read-only AVD on port 5556) against a test bridge (port 8790/8791, disposable Herdr session, fake model server scripting a list, a read and a send): home row, chat bubbles, chips open the agent, stop, new, report opens a mail draft, busy and unavailable notices, old-bridge notice against the 0.5.1 dist build. Record results in `docs/verification.md`.
- [ ] **Step 3: Live read-only check** on the user's bridge after restart: ask Hermes "what's everyone doing?" (reads only, no sends), confirm the answer lists real agents, the model shown, and that no Herdr agent of kind `hermes` appeared. Record (without conversation text) in `docs/verification.md`.
- [ ] **Step 4: Run** `npm run lint:fix && npm run typecheck && npm test && npm run build:bridge && npm run integration && npx expo-doctor` (in `mobile/`) — Expected: all pass.
- [ ] **Step 5: Commit** `chore: release 0.6.0 with the Hermes coordinator`
