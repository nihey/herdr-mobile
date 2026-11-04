# Agents home screen widget — design

## Why

The user wants an Android home screen widget showing which of their agents are working, which are idle and which need input, so they can check on them without opening the app.

## Decided with the user

- A widget the user adds to their Android home screen.
- It shows three groups of agents: **working**, **idle** and **needing input**.
- The user skipped the design questions, so everything below is the builder's call.

## Builder's calls

### What it shows

- **Which machine:** the app's active machine. The header shows its name. Switching machines in the app redraws the widget for the new one.
- **Counters:** `● input`, `◐ working` and `○ idle`, using Herdr's marks and the app's colors. Herdr's `done` (✓, finished a turn) and any unknown status count as idle, because the user asked for three groups. Rows still show the agent's real mark.
- **Rows:** one line per agent: mark, agent name (or its project), then the cleaned terminal title, dimmed. Agents needing input come first, then working, then idle, each group in Herdr's order. As many rows as fit the widget's height, then `+N more`. Plain terminals are not listed.
- **Sizes:** the default is 4×2 cells. It can be resized both ways. A widget one cell tall shows only the header and counters.
- **Freshness:** the header shows the time of the last successful read (`14:32`). An offline read keeps the last agents it saw, dimmed, with `offline · last 14:32`. It never shows stale data as current.
- **Empty states:** no paired machine → `pair a computer in herd remote`. No agents → `no agents running`. Storage that can't be read → `open herd remote`.

### Taps

- Tapping a row opens that agent in the app: `herdr-mobile://agent/<paneId>?machineId=<id>`. The agent route already sends the user home when the machine ID isn't the active one, so a widget drawn before a machine switch can never open a pane on another host.
- Tapping the header or the counters opens the app home.
- **↻** reads again right away.
- No tap sends anything to an agent. The widget is read-only.

### When it updates

- When it's added or resized, when the user taps ↻, and every 30 minutes through Android's widget updates (`updatePeriodMillis`; Android won't go lower).
- While the app's home screen is open, every successful agent-list poll redraws the widget when the list changed, and otherwise at most once a minute. That costs no extra network calls.
- After a machine change (activate, add, remove, forget) the widget reads the new active machine.
- No foreground service, push service or background scheduler. The project has no external services, and Android limits background work to 15–30 minutes anyway. The update time in the header keeps this honest.

### How it's built

- `react-native-android-widget` (MIT, Expo config plugin, renders React-style widget trees from a headless JS task). It's configured in `app.json`, so `android/` stays generated.
- `mobile/index.ts` becomes the entry point: it imports `expo-router/entry` and registers the widget task handler.
- **Credentials:** the widget reads the active machine from SecureStore through a new read-only `MachineStore.peek()`. It reads the v2 index and the active profile only, never migrates or writes, and returns null when only a v1 record exists (the app migrates that the next time it opens). A widget task can run while the app changes machines, through its own `MachineStore` and write queue, so the widget must never race the app's writes. The token stays in memory for the one request.
- **Data:** a new explicit `WIDGET_AGENTS` query that asks only for the fields it shows (`workspaces { id label }`, `agents { paneId workspaceId name kind title status }`). It's valid on a 0.4.0 bridge, so no bridge change is needed, and it's covered by the existing bridge compatibility test. A 15 s timeout keeps it inside the library's 30 s headless task limit (`createClient` gets an optional timeout).
- **Memory only:** the last snapshot per machine is kept in JS memory so an offline read can show it dimmed. The app writes nothing about agents to storage and logs nothing. The widget library saves the last drawn widget as an image in the app's private storage, replaced on every redraw and deleted with the widget. That image isn't in backups (the backup rules include only shared preferences).
- **Switches:** a read that ends after the active machine changed draws nothing, so a slow read can't put the old machine back. A widget-task draw clears the app's redraw dedupe, so an `offline` drawn by ↻ is replaced on the app's next successful poll. While redrawing an older snapshot as refreshing, the header dot is dim, not green.
- **Look:** the app's tokens from `src/components/ui.tsx` (background `#171421`, panel, line, the status colors) and Noto Sans Mono Regular/Bold. The widget library loads fonts only from `assets/fonts`, so the two TTFs are copied there through its plugin (about 1 MB). The outer corners are 16 dp to match Android 12+ widgets, inner elements 4 dp.
- **Adding it:** the connection settings sheet gets **add home screen widget**, which asks the launcher to pin it (`requestPinWidget`). When the launcher can't pin, it explains: long-press the home screen → Widgets → Herd Remote.
- **Lock screen:** the default `home_screen` category only.

### Privacy

- Agent names, statuses and terminal titles from the active computer appear on the home screen, where the launcher draws them. They come straight from the user's bridge over the same connection the app uses. Nothing goes to any other service. PRIVACY.md says this.

## Not included

- Choosing a machine per widget, or showing several machines.
- Sending prompts or keys from the widget.
- Updates more often than Android's 30 minutes while the app is closed.
- Lock screen placement.
