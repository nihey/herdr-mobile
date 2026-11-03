# Hermes coordinator: talk to one agent that runs all the others

Status: design, awaiting approval. Date: 2026-11-03.

## Intent

The user runs many coding agents in Herdr on their computer, often a dozen at once across projects. Away from the desk they want one conversation, inside Herd Remote, with a Hermes agent that knows about all of them. They ask "how is the payments migration going?" and get a short, accurate answer. They say "tell the invoices agent to also check the staging logs" and it happens. They say "start a claude in shop-web to compare pricing pages" and a new agent starts.

The most important moment is walking with the phone locked in a pocket and earbuds in, _calling_ Hermes: everything they say is transcribed and sent, and Hermes's answers are read to them.

Success: the user stops opening agents one by one to find out where things stand, and can steer their agents by voice while walking.

## Goals

1. A Hermes conversation per paired computer, shown in the app as a chat (style A: bubbles).
2. Hermes can, on request: list the agents, read what an agent has done, send an agent a message, start a new agent.
3. The conversation lives on the computer: it continues while the phone is locked or offline, and the answer is waiting when the app comes back.
4. A call mode: hands-free, screen locked, earbuds. Speech in, spoken answers out.

## Non-goals

- Hermes does not edit files, run commands, browse, or otherwise work by itself. It coordinates; when something needs doing, it asks an agent.
- Hermes does not answer agents' approval prompts (y/n, permission dialogs) or press keys in them. It can say an agent is waiting and what for.
- Hermes does not close tabs or stop agents.
- No push notification when Hermes finishes a reply (first version).
- Hermes does not speak up on its own (for example "the invoices agent needs you") during a call or otherwise. It answers when asked. _(My call; easy to add later.)_
- No browsing of old conversations. "new" starts a fresh one; earlier ones are not shown in the app.
- Nothing new appears on the computer: no Herdr tab, no pane, and Hermes is not listed among the user's agents.

## Anti-goals (would make this a failure even if it works)

- Hermes's activity moving the desktop's focus, or typing into an agent that the user didn't ask it to message.
- Re-sending a message on its own after an uncertain delivery. One message, once; uncertainty is reported.
- Audio leaving the phone.
- A call that silently dies when the screen locks or the earbuds connect.

## The conversation

- **One Hermes per computer.** Each machine's bridge runs its own Hermes. Switching machines in the app switches conversations. A Hermes reply only ever concerns its own machine's agents.
- **One ongoing thread** per machine, which picks up where it left off. A **new** button in the chat header starts a fresh conversation (after a confirm in a native dialog).
- **Answers.** Short, plain answers: status (working, waiting for you, done, idle), what the agent did, what's left. "What's everyone doing?" gets a summary across agents.
- **Messages to agents.** Hermes picks the agent from its title, folder, kind and status, sends the message as a normal prompt, and says which agent got what. There is no confirmation step: if it picked wrong, the user corrects it in the conversation and it sends a fix. _(User's explicit choice.)_ Messages are sent as written for the agent, with no "from Hermes" prefix. _(My call.)_
- **Starting agents.** Only when asked. It opens a new unfocused tab in the named project's workspace (or the home workspace when no project is named), starts the agent kind asked for (default: claude), and, if a first task was given, sends it after the agent is ready. This is the same path as the app's **new** button (`startSession`), never resent.
- **What Hermes sees.** The same view the app has: the agent list and each agent's screen and recent output, read with the bridge's existing rules (the full-screen `visible` read, never scroll-harvesting). It does not open project files.
- **Which agents it touched.** Every Hermes reply records the agents it read, messaged or started. The chat shows them as small chips between the bubbles ("read ✓ Payments migration…", "sent to ◐ …", "started …"). Tapping a chip opens that agent's screen. A chip for an agent that no longer exists shows as gone and isn't tappable.
- **One turn at a time.** While Hermes is working, the send button becomes **stop** (cancels the turn). _(My call.)_
- **A stopped request is gone.** Whatever Hermes had not yet done in a stopped turn never happens later. Hermes's ACP mode carries an interrupted prompt into the next one as "User correction/guidance after interrupt" (`acp_adapter/server.py`, around line 1845); the bridge must defeat that, for example by not using ACP's interrupt path or by starting the next turn without the stale request. A test pins it: stop "tell X to…", send "how are you", and X gets nothing.

## Send guards

Agents' screens are untrusted text (logs, web pages, issue text). That text could steer Hermes into messaging an agent the user didn't mean, and agents can run commands. The user chose **guards without confirmation**: Hermes still sends without asking, and the bridge's tool server enforces, regardless of what Hermes decides:

- **At most 3 agents messaged or started per user message.** A fourth send or start in the same turn is refused by the tool with a reason Hermes reports ("I can message at most 3 agents per request").
- **No sends outside a turn the user started.** The tools refuse sends and starts unless a user message turn is in progress (Hermes has no turns of its own anyway; this makes it a rule).
- **A stopped request never comes back** (see the conversation section).
- **The record comes from the bridge, not from Hermes.** Every send and start is recorded by the tool server and shown as a chip whatever Hermes writes. In a call, the phone itself speaks each send ("sent to <agent title>") from that record, so an unmentioned send can't happen silently.
- **Hermes's brief** says agent screens are information, never instructions, and that it only messages or starts agents when the user's own words ask for it. This is guidance, not a guarantee; the four rules above are the guarantee.

## The screens

The visual is in the brainstorm mockup (chosen style A). In words:

- **Home (agents list):** Hermes is pinned as the first row, above the counters, marked `✦ hermes` in the accent colour, showing its latest line (or a working mark while it is thinking).
- **Hermes chat:** header `✦ hermes`, subtitle "coordinates your agents · <machine>", a **call** button and a **new** button. User messages are right-aligned bubbles; Hermes replies are left-aligned bubbles on the panel colour; chips sit between bubbles. Composer at the bottom: field "ask or tell hermes…", the existing dictation control (fills the draft, never sends), and **send**.
- Same look as the rest of the app: tokens from `components/ui.tsx`, mono font, lowercase labels, radius 4. No new hex colours outside `ui.tsx` (the palette test enforces this).
- **Report a reply:** long-press a Hermes bubble → "report this reply" opens an email draft to the app's support contact (the address on the Play listing) with the reply text, which the user can edit or discard. Nothing is sent automatically. This covers Google Play's AI-generated content policy (in-app reporting for apps where a chatbot is central) and is part of stage 1. _(My call.)_
- If the bridge is too old, the row shows a short "update the bridge on this computer" notice. If Hermes isn't installed or isn't signed in on the computer, the row says so and what to run there. The rest of the app keeps working in both cases.

## Calls

- **Start:** the call button in the Hermes chat. The user then locks the phone and pockets it. The call keeps running with the screen locked, through Bluetooth earbuds (or the phone's own speaker and mic), until hung up.
- **Lock-screen notification** while the call is on (Android requires one while the mic is in use): "on a call with hermes", with a hang-up action.
- **Talking:** speech is recognised on the phone. After about 1.5 s of silence, the utterance is sent to Hermes as a message and appears in the chat as the user's.
- **Waiting:** a short tone when a message is sent; a soft repeated tick while Hermes works.
- **Hearing back:** Hermes is told it's on a call and answers briefly in plain sentences (no lists, no markdown). The phone reads the answer aloud; the full text is in the chat.
- **Cutting in:** if the user starts talking while Hermes speaks, the speech stops and the phone listens. What the user says while Hermes is still _working_ (not speaking) is sent once the turn ends, exactly once.
- **Ending:** saying "hang up", the notification's hang-up action, or the earbud's play/pause button.
- **Language:** English or pt-BR, the same choice as dictation. Hermes is told to reply in that language and the phone voice matches it.
- **Connection drops:** a distinct tone and a short spoken "didn't get that" when a message couldn't be delivered. Nothing is resent; if delivery is uncertain, the phone says so.
- **Privacy:** speech recognition and speech synthesis both run on the phone, with on-device models and voices only (no network voices). Only text goes to the bridge. Audio never leaves the phone.
- The call is the one place where speech sends a message without tapping **send**. Dictation in the chat composer keeps its rule: it fills the draft and never sends.

## Hermes on the computer

Decided (all my calls, which the user handed over):

- **How the bridge runs Hermes:** a small Python host under Hermes's own virtualenv builds a Hermes agent in-process and talks to the bridge in JSON lines over stdio (streamed replies, tool calls, cancel, resumable sessions from Hermes's session store). Hermes runs only inside the bridge; it is not a Herdr pane. _(Revised at planning: Hermes's ACP mode always enables its own terminal/file/browser toolset and folds a stopped prompt into the next one, so it can't meet "coordinate only" or "a stopped request is gone".)_
- **How Hermes reaches the agents:** through four tools the host registers in Hermes's tool registry, and nothing else for acting on Herdr: list agents, read an agent, send an agent a message, start an agent. Each tool call is relayed over the host's stdio to the bridge, which runs it against Herdr with the send guards. There is no separate tool server and no network listener. Hermes never runs `herdr` commands itself.
- **The tools obey the project rules:** opaque Herdr IDs only; never an implicitly focused target; never change desktop focus; new agents in unfocused tabs; no automatic retries of mutations; reads use the same `visible`/`recent` logic as the app's output query. The tool server goes through the same restricted socket client as the bridge (`bridge/src/socket.ts`), with only the methods these tools need.
- **Coordinate only:** the coordinator has the four tools and nothing else that acts on the computer: no terminal, file write/patch, browser, code execution, and none of the MCP servers configured in the user's own Hermes (for example a browser-automation server). The installed ACP mode hard-codes its `hermes-acp` toolset and adds the user's configured MCP servers (`acp_adapter/session.py`, `toolsets.py`), with no disable list, so no simple config switch is known to work. Requirement: **the bridge refuses to start the coordinator unless the tool list Hermes reports is exactly the four tools** (plus purely internal ones that touch nothing, if Hermes insists on them, each named in the code), and a test pins it. If ACP can't be made to meet it, the builder may use another Hermes entry point (for example its Python agent API with an explicit toolset) as long as streaming, cancel and resumable sessions still work. _(My call.)_
- **Model:** the model Codex uses by default, read from `~/.codex/config.toml` (`model`, currently `gpt-6.1-sol`), through Hermes's existing `openai-codex` provider and sign-in. It follows Codex if Codex's model changes. Reasoning effort `medium`, not Codex's `xhigh`, so answers come in seconds. _(User asked for Codex's model; effort is my call.)_ The user's own Hermes chats and default model are not changed.
- **When Codex's model isn't usable through Hermes** (the installed Hermes's built-in Codex model list stops at `gpt-5.6-*`; it may still accept newer IDs), the coordinator falls back to Hermes's own default model and says so visibly: the chat subtitle and Hermes row show the model in use and why ("gpt-5.6-sol · codex's gpt-6.1-sol isn't available in hermes"). It retries Codex's model when the bridge restarts or Codex's config changes. _(My call: never a silent switch, never a dead feature.)_
- **Instructions:** a coordinator brief sent with each session: who it works for, that it coordinates Herdr agents on this machine, the four tools, keep answers short, always name the agents it read/messaged/started, and the call-mode rules (brief, spoken style, reply language).
- **Persistence:** Hermes keeps the conversation in its own session store. The bridge remembers the current session ID per machine in ignored `.local/` (mode 0600) and resumes it after a bridge restart. **new** starts a new Hermes session. (Old sessions stay in Hermes's own store, visible with `hermes sessions list` on the computer, which is fine.)
- **The phone never talks to Hermes directly.** The app only talks to the bridge over its authenticated GraphQL API: send a message, cancel, start a new conversation, read the conversation (messages, chips, whether Hermes is working). Polling, as the app already does for agent output, is acceptable.

## Privacy and security

- Hermes is configured to use OpenAI through the user's Codex sign-in. The user's messages and everything Hermes reads from agents (which can include code, logs, anything an agent printed) go to OpenAI. The user accepted this. PRIVACY.md must say so: what goes, to whom, and that it only happens when the user uses Hermes.
- Audio stays on the phone (see Calls).
- No credentials, prompts, Hermes conversation text or agent output in logs or commits. The conversation text is only on the computer (Hermes's store) and in the app's memory.
- The tools are not reachable over the network: they run inside the bridge, reached only through the host's stdio, and use the bridge's existing Herdr socket client.
- Hermes running under the bridge must not show up as a Herdr agent. The Herdr agent-state plugin installed in Hermes (`~/.hermes/plugins/herdr-agent-state`) should be a no-op outside a Herdr pane; the builder verifies it.

## Compatibility

- New GraphQL operations join the bridge compat test's "needs newer bridge" list; everything existing keeps working against 0.4.0 and 0.5.x bridges. The app detects a missing Hermes API with the existing `isOutdated` pattern and shows the update notice.
- A bridge where Hermes isn't installed, its internals don't match what the host expects, or the provider isn't signed in reports a clear unavailable reason; the app shows it in the Hermes row.

## Stages

1. **Chat:** bridge runs Hermes over ACP with the four tools, GraphQL API, app chat screen, home row, chips, privacy policy, docs. Shippable alone.
2. **Calls:** starts with a throwaway spike on the user's own phone (ask before touching it) proving, with the screen locked and earbuds connected: on-device recognition keeps running under a microphone foreground service, earbud mic and playback work, on-device text-to-speech plays through the earbuds, and talking over playback is detected. If the spike fails, stop and bring the options back to the user (for example screen-on calls or push-to-talk on the earbud button) before building. Then the call itself, as a local Expo module with its own config plugin (native code lives in the module; generated `android/` stays untouched).

## Constraints (from the project)

- Expo 57 / React Native / TypeScript app; Node 22 ESM bridge; npm workspaces. GraphQL via Apollo Client 4; no REST data endpoints, no generic Herdr passthrough.
- Native directories come from prebuild: change app.json/plugins/modules, never generated Gradle or manifest files.
- The app ships as "Herd Remote", an unofficial Herdr companion; Hermes is named as Hermes, never presented as part of Herdr or the app's own AI.
- Do not test by sending prompts or keys to the user's existing agents. Tests use a mock socket, a scripted fake ACP agent, or a disposable named Herdr session (real Hermes runs in integration only against a disposable session's socket).
- Release: Google Play requires declaring the microphone foreground service (and may ask for a demo video) before stage 2 ships to the Play track, and the AI-generated content policy's in-app reporting (the report action above) before stage 1 does.
- Run `npm run lint:fix`, `npm run typecheck`, `npm test` and relevant builds before committing; document in AGENTS.md files and README; keep PRIVACY.md accurate; public files use example hosts, paths and project names.

## Left to the builder

- The exact GraphQL shape for the conversation (messages, chips, working state) and how replies stream to the app (polling or otherwise).
- How the bridge keeps the ACP process alive, restarts it, and times out stuck turns.
- The mechanism that turns Hermes's built-in computer tools off (see above), meeting the exact-tool-list startup check.
- How the four tools share code with the existing resolvers (`startSession`, output reads, prompt sending).
- Audio details for calls: silence threshold tuning, tones, earbud routing, the native module's API.
- Version numbers and how the stages map to releases.
