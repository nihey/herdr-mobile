# Plain terminals and a Herdr-style look — design

## Why

- Away from the computer, the user wants to run shell commands, or start `claude` by hand with their own flags, either in a project or somewhere not tied to a project. Today the app can type into existing non-agent panes ("Other terminals") but cannot open a new one.
- The app should look like the terminal the user works in all day: Herdr running inside GNOME Terminal. Two things bother them now: the keyboard sometimes covers the text box being typed into, and the launch screen is animated.

## Decided with the user

### Terminals

- The **New session** sheet gets a **Terminal** choice next to the agent kinds: a plain shell, no agent.
- The project list gets **Home folder** at the top, for a terminal not tied to any project.
- With Terminal chosen, the "first task" box becomes an optional **first command**, run once the shell is ready.
- In a project: a new tab in that project's Herdr workspace and folder, without switching the desktop to it (same as New session).
- Home folder: the first time, the app creates a Herdr workspace in the home folder; later home terminals open as new tabs in it, so workspaces don't pile up.
- In a terminal, **Send runs the command**: it types the text and presses Enter. (Today Send only types and the user taps Enter separately.)
- After starting, the app opens the existing terminal screen (live output, text box, key row). Typing `claude` there shows up as an agent through Herdr's own detection (it already detects hand-started agents: that is how the user starts theirs).
- Not included: closing terminals from the app. Tabs stay until closed on the computer.

### Look: option B, "like Herdr itself"

The chosen mockup is `.superpowers/brainstorm/336641-1793711216/content/look.html` (local, git-ignored), option B.

- Colors sampled from the user's screen (GNOME Terminal's default dark scheme plus Herdr's default catppuccin theme). The current green palette goes away entirely.

  | Token | Value | Use |
  |---|---|---|
  | background | `#171421` | every screen, the terminal output, the launch screen |
  | terminal text | `#D0CFCC` | terminal output |
  | panel | `#1E1E2E` | counters, inputs, keys |
  | surface / line | `#313244` | borders, pressed states |
  | text | `#CDD6F4` | names, headings |
  | muted | `#A6ADC8`, dim `#6C7086` | secondary text, meta lines, labels |
  | accent | `#89B4FA` | buttons, selection, prompts, links |
  | needs input | `#F38BA8` | status, Ctrl+C, errors |
  | working | `#F9E2AF` | status |
  | done | `#A6E3A1` | status, success |

- Monospace everywhere, lowercase labels ("agents", "working", "new"), Herdr's status marks (● needs input, ◐ working, ✓ done, ○ idle), and highlighted rows (accent at about 14 % opacity with a 2 px accent left edge) instead of rounded cards. Corners are small (about 4 px).
- The terminal key row (Esc, Tab, arrows, Enter, Ctrl+C) is a single line that scrolls sideways. It never wraps.
- Launch screen: plain `#171421`, no logo, no animation, gone as soon as the app is ready.
- The keyboard never covers the text box being typed into. The case the user hits is the first screen, when setting up the first machine (`ConnectScreen`, the pairing form, which has no keyboard handling on Android). Fix that, and check every other screen with a text field.

## Builder's calls (made by the assistant, not the user)

- **Scope of the look:** every screen and sheet: home, terminal/agent screen, connect and pairing, machines, New session, start-agent, error and speech sheets.
- **Font:** the user's terminal font is Noto Sans Mono (GNOME's "Monospace" resolves to it). Bundle Noto Sans Mono Regular and Bold (SIL OFL) at build time through the `expo-font` config plugin, with `monospace` as the fallback.
- **Status marks:** blocked → ● needs-input color, working → ◐ working color, done → ✓ done color, idle → ○ dim, unknown → · dim.
- **Home folder** is the bridge user's home directory (`os.homedir()`, injectable in `createBridge` for tests). The app never sends a path. The Home folder entry also works for agents, so the sheet stays project → kind → task with no special cases.
- **Home workspace:** labelled `phone`, found by that label alone (Herdr workspaces have no folder of their own, and a pane's folder changes with every `cd`, so matching on folders would create duplicates). Stateless, so it survives bridge and Herdr restarts; the trade-off is that a workspace the user names `phone` themselves is treated as the home workspace. If none exists the bridge calls `workspace.create { label, cwd: home, focus: false }` and uses the new workspace's root pane as the first terminal (no extra tab); later terminals are `tab.create` with `cwd: home`. If the user renames or closes it, the next home terminal creates a new one. The `phone` workspace is not listed again as a project in the sheet (Home folder covers it).
- **Run applies to every plain terminal** (any pane without an agent, including the existing "Other terminals"), not only ones opened from the app. A **Type** chip beside it types without Enter, for Tab completion or partial input; Run is the default each time the screen opens. Run is two mutations (text, then Enter); if the text went through but Enter failed, nothing is resent and a notice says the command was typed but not run. Agent screens keep Prompt/Type as they are. Update the mobile AGENTS.md rule that described the old two-step.
- **Agent started by hand in a terminal:** once Herdr reports an agent in that pane, the terminal screen offers the same controls as any agent screen (Prompt/Type), instead of staying locked in terminal mode.
- **GraphQL:**
  - `Mutation.startTerminal(workspaceId: ID): StartedTerminal!` returning `{ paneId, tabId, workspaceId, ready }`. A null `workspaceId` means the home workspace. Tab label `terminal`. `ready` means the shell sat alone at its prompt (existing read-only `waitForShell`); false if that timed out.
  - `startSession.workspaceId` becomes optional with the same null-means-home rule.
  - `Query.homeFolder: String` (the home path, shown in the sheet with `shortPath`) so the sheet can label the entry; null on old bridges.
  - Same validation, error shape (`code`, `paneId`, `tabId`) and timing budget as `startSession`. No retries.
- **First command:** sent by the app after start with the existing `sendText` and Enter mutations, only when `ready`. If not ready, or either mutation fails, nothing is resent: the terminal opens with the command restored as the draft and a notice (same pattern as the first task).
- **Old bridge:** `homeFolder` is fetched in its own query, so an old bridge still serves the existing sheet. Choosing Terminal or Home folder against a bridge without `startTerminal`/`homeFolder` shows "update and restart the bridge"; agent sessions in projects keep working.
- **Testing:** unit tests against a mock socket; the live integration test uses a disposable named Herdr session with `/bin/sh` and the restricted PATH, starts a terminal in the test workspace and a home terminal with an injected temp home, and types only a harmless `printf` marker. Never type an agent name, never touch the user's sessions.
- **Release:** version 0.5.0, versionCode 5. Docs (AGENTS files, README, PRIVACY.md: commands typed into terminals go to the user's computer like prompts) updated.

## Non-goals

- Closing terminals or tabs from the app.
- Picking arbitrary folders (only open projects and the home folder).
- A full terminal emulator: typing stays text box + key row; output rendering is unchanged apart from colors and font.
- A light theme, or changing the app icon and Play listing.

## Anti-goals

- Sending a command or keys to any existing terminal or agent of the user's, in use or in testing.
- Switching the desktop's focus to a new tab or workspace.
- Resending a command after an uncertain failure.
