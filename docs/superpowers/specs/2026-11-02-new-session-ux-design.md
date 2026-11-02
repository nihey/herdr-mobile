# New sessions and home UX — design

## Why

Away from home, the user wanted another agent working on a project already open in Herdr. Every terminal in that workspace was busy (their layout is one workspace per project, one tab, one agent), so the existing "Start an agent here" (idle panes only) had nowhere to go.

## Decided with the user

- One floating **New session** button on the home screen (option B), not per-project buttons.
- The sheet asks for the project first (an open Herdr workspace with its folder), then the agent, then an optional first task (typed or dictated).
- Starting opens a **new tab** in that workspace in the project folder and launches the agent there. Existing agents are untouched. The app waits for readiness (about 40 s at most), sends the first task if any, and opens the new terminal.
- Not included: folders that are not open in Herdr, git worktrees.

## Calls made by the builder

- Project order follows Herdr's workspace order (there is no recency data in the snapshot). If the home screen is filtered to one workspace, the sheet starts with it selected.
- Project folder = the shell `cwd` (fallback `foreground_cwd`) of the workspace's first pane. The bridge computes it; the client never sends a path.
- The new tab is not focused on the desktop (`focus: false`) and is labelled with the agent name.
- Agent kind defaults to the kind most used in that workspace, then in the session. Chips show kinds in use; **More** reveals the rest of the kinds Herdr supports (`server.agent_manifests`). Supported ≠ installed; Herdr reports a missing CLI.
- Generated name `<kind>-<n>` (lowest free n), editable. Names used by live agents are rejected before a tab opens, and the name is frozen on submit so a repeat after an uncertain failure is rejected instead of opening a second tab.
- Agent failed to start after the tab opened (including a CLI that exits right after launch, which Herdr reports only via `agent.wait` → `agent_not_found`): the error carries the pane ID; the sheet offers **Open the new terminal** and keeps the typed task as its draft. The tab is never closed automatically.
- First task failed after start: no resend. The app opens the terminal with the task restored as the draft and a notice to check before resending. The draft is handed over in memory, never via route params.
- An old bridge without the new fields gets a "update and restart the bridge" message.

## Home UX pass (builder's calls)

- Branding: headers say **Herd Remote**, not "herdr" (AGENTS.md: never brand as Herdr itself).
- Agents needing input sort first; others keep Herdr order.
- Compact agent cards: project first (or the agent's name when it has one), terminal title/task line, kind and folder. The filler footer row is gone, so roughly twice as many agents fit.
- The Total / Working / Needs input counters double as status filters.
- Pull-to-refresh shows its spinner until the refresh completes.

## GraphQL additions

- `Workspace.cwd: String` — project folder as above.
- `Query.agentKinds: [String!]!` — validated kind names from `server.agent_manifests`.
- `Mutation.startSession(workspaceId: ID!, kind: String!, name: String!): StartedSession!` — `tab.create` then `agent.start`. Returns `{ paneId, tabId, workspaceId, name, kind }`. Same name/kind validation as `startAgent`; unknown workspace is `BAD_USER_INPUT`; agent failure keeps the daemon code and adds `paneId`/`tabId` to the error extensions. No retries.
