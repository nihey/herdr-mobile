# Bridge

- TypeScript strict mode, Node 22+, ESM (`.js` extensions in TS imports).
- `src/socket.ts`: bounded one-request-per-connection JSON socket transport, unique request IDs, no retries.
- `src/schema.ts`: explicit GraphQL schema, camelCase fields mapped from Herdr snake_case, validation before daemon access.
- `src/server.ts`: authentication before request parsing/execution, bounded body/query size, POST-only /graphql.
- `src/config.ts`: Tailscale IP discovery, socket/env configuration, credential generation. `src/index.ts`: HTTP listener and CLI pairing output.
- `src/discovery.ts`: bounded async `tailscale status --json` (4 seconds, 2 MiB), safe field projection, private tailnet IP validation, shared in-flight reads and a 10-second success cache. Discovery uses the connected bridge's visibility; it does not check remote bridge installation or phone reachability.
- Installed `herdr api schema --json` is the source of truth. For Herdr 0.9.4 reads use `recent_unwrapped`, not the CLI spelling `recent-unwrapped`.
- GraphQL maps session snapshot, agent/pane output, prompts, keys, literal terminal text and agent startup. Server shutdown and arbitrary shell execution are not exposed.
- `Workspace.cwd` is the shell cwd (fallback foreground cwd) of the workspace's first pane. `Query.agentKinds` lists validated kinds from `server.agent_manifests` (supported, not necessarily installed).
- `Mutation.startSession(workspaceId, kind, name)`: `tab.create` (`focus: false`, label = name, project cwd) → read-only `pane.process_info` polling until the shell is alone in the foreground (startup scripts finish) → `agent.start` → `agent.wait` for idle/done/blocked. Returns `ready: false` if still starting within the 38 s budget (under the app's 45 s timeout). agent.start succeeds before the launch is confirmed, so `agent.wait` → `agent_not_found` (e.g. CLI not installed) is a failed start. Duplicate live agent names are rejected before `tab.create`. The shell check and `agentKinds` are optional and never block a start. Start failures keep the daemon code and add `paneId`/`tabId` extensions; blocked at startup is `agent_not_ready`. No retries. Read-only methods are listed in `socket.ts` so their transport failures are not reported as uncertain delivery.
- `Query.discoveredMachines` requires the same bearer token as all other data. Do not expose raw Tailscale status, peer keys, users, public endpoint addresses or traffic data.
- `npm run dev` runs tsx watch; `npm run build` and `npm start` run compiled code. Run commands from the root with `-w bridge` to preserve cwd/config behavior.
- Tests use a mock Unix socket and Yoga fetch adapter. Use root `npm test` for the complete suite.
