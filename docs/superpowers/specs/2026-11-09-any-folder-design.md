# Sessions in any folder — design

## Why

The user wanted to start an agent in a project folder under `~/devel` that was not open in Herdr. The new session sheet offered only open projects and the home folder, so the session ended up in the home folder. Earlier designs left arbitrary folders out on purpose (2026-11-02 and 2026-11-03 specs); this reverses that at the user's request.

## Decided with the user

- Any folder on the computer, not only `~/devel`: browse freely, and projects under `~/devel` are a tap or two away.
- A folder that is not open in Herdr becomes its own Herdr workspace on the computer, like the user's other projects (one workspace per project), not another tab under `phone`.

## How it works

- The sheet's project list gets **browse folders…** right under **home folder**. It opens a folder browser in the same sheet that starts in the home folder: tap a folder to open it, `..` to go up, **use <folder>** to choose the folder being shown. The field filters the folder names; text starting with `~` or `/` is a path to go to; hidden folders appear once the text starts with `.`.
- After choosing, the sheet continues as before (agent kind or terminal, name, first task). The confirmation line says the folder opens as a new Herdr workspace.
- Bridge placement for a chosen folder: the home folder → the home workspace (unchanged); a folder an open project is in (its first pane's folder) → a new tab in that project; anything else → `workspace.create` in that folder, unfocused, with no label so Herdr names it after the folder (verified on Herdr 0.9.4), and its root pane runs the session. From then on the folder is listed as a project.

## Builder's calls

- `Query.folders(path)` returns names and paths only. The bridge never opens files. Real paths (links resolved); links to folders count; names the app could not send back (control characters, invalid UTF-8) are left out. At most 500 folders per level (10 000 entries read) and 5 seconds per read, so a huge or hung folder (a network mount) cannot hold the request. Reads run one at a time: a read stuck on a hung mount keeps its file-system thread, so later reads time out without starting (asking to restart the bridge) rather than using up the bridge's threads.
- The folder is resolved and checked (exists, is a folder, may be opened) before Herdr is contacted. `folder` and `workspaceId` together are refused.
- The `phone` workspace never counts as a project folder, wherever its shell has moved. A folder whose name is `phone` would get a workspace labelled `phone` and later be taken as the home workspace (the known label trade-off).
- Only the bridge's real home folder is shown as `~`. If the home folder cannot be listed, a typed path still works.
- Nothing about folders is stored on the phone: each listing is fetched with `no-cache` and kept only while the sheet is open. The browser always starts at home.
- New operations (`FOLDERS`, `START_FOLDER_SESSION`, `START_FOLDER_TERMINAL`) are separate, so an older bridge still serves projects and the home folder; there the browser shows the update message.
- Not included: creating folders from the phone, remembering the last folder, Hermes starting agents in arbitrary folders.
