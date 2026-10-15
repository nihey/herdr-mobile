# Herdr Android companion — design

Status: user requested Expo in response to the proposed architecture; proceeding with Expo and the authenticated GraphQL bridge.

## Outcome

An installable Android app that connects to the user's existing Herdr installation over Tailscale, displays agents and terminal output, and lets the user direct agents from their phone. Deliver source, a standalone APK for personal sideloading, a local bridge launcher, and setup instructions.

## Verified environment

- Workspace: `~/devel/herdr-mobile`, initially empty.
- Installed Herdr client and running server: 0.9.4, private protocol 22.
- Local socket: `~/.config/herdr/herdr.sock`.
- Discover the Tailscale IPv4 at startup rather than hardcoding a machine address.
- Android verification uses a disposable emulator; no personal device identifiers are recorded.
- Installed `herdr api schema --json` is the protocol authority. Upstream reference: https://github.com/herdrdev/herdr, inspected at commit `916fcf8de029c6cac965b50f3cdb9687cd7d1537`.
- Herdr's public API is JSON over a local socket; joining the tailnet alone does not expose it to the phone.

## Approach and alternatives

Use an npm monorepo with a Expo / React Native / React 19 / TypeScript app with native components, and a small TypeScript ESM GraphQL bridge on the host. Use Apollo Client 4 for app data operations.

The user selected Expo for native widgets and familiar mobile tooling. Kotlin with SSH would remove the bridge but introduce SSH credentials, host-key verification, and a separate native codebase. The recommended approach keeps the user's TypeScript and React conventions and talks directly to the existing Herdr daemon.

This project adapts the usual backend stack: the bridge is a protocol adapter, so it needs no Strapi, PostgreSQL, user accounts, payments, or worker. It neither replaces nor upgrades Herdr.

## Structure

```text
herdr-mobile/
  mobile/          Expo React Native app, generated Android project
  bridge/          Authenticated GraphQL to Herdr socket adapter
  packages/shared/ Shared types and protocol mappings if useful
  docs/            Design and implementation notes
  dev.sh           tmux launcher
  AGENTS.md        Cross-project conventions
  README.md        Setup, pairing, APK build, troubleshooting
```

Each executable subproject documents its own conventions in AGENTS.md and configuration in .env.example. npm workspaces manage dependencies. Prefer Node 22 LTS for the bridge; validate compatibility with the currently installed runtime as well.

## Connection and authentication

1. The bridge runs as the same OS user as Herdr, opening its socket directly through Node's net module. It does not interpolate commands into a shell.
2. By default, the launcher discovers and binds the machine's Tailscale IPv4 on port 8787. Allow an explicit host for localhost development; do not default to a wildcard listener.
3. Generate a high-entropy pairing token in an ignored local file with mode 0600. All GraphQL operations require a bearer token, checked before execution. Never log token headers or prompt/output contents.
4. The app asks for the bridge URL and token, tests the connection, and saves the connection settings in Expo SecureStore. The token is a credential to control the host user's Herdr session. Provide an explicit disconnect/forget action that clears it and Apollo state.
5. Native Android networking supports private HTTP addresses for tailnet access; Tailscale supplies transport encryption. Also accept HTTPS endpoints. This assumes both phone and host are connected to the user's tailnet with suitable ACLs.
6. No public hosting, port forwarding, or external authentication service is required. The token is independent of Tailscale identity.

## GraphQL boundary

Define explicit schema and resolvers. No arbitrary raw socket method passthrough and no REST endpoints for app data.

Queries:

- Connection/server metadata and capabilities, from `ping` and/or `session.snapshot`.
- Session snapshot: workspaces, tabs, panes, agents, version and protocol.
- Agent output, using `agent.read` with `recent-unwrapped` or `visible` and a bounded line count.
- Pane output for an available shell or unrecognized process, using `pane.read`.

Mutations:

- Prompt a named agent or explicit pane target through `agent.prompt`.
- Send a bounded set of logical keys through `agent.send_keys`; pane keys for explicit raw pane control.
- Start a named agent of a supported kind in an explicitly selected existing pane through `agent.start`. Herdr validates shell availability.

Do not expose server stop, arbitrary process execution, installation changes, or workspace deletion in this first version. Reading/selecting agents must not move desktop focus. Use Herdr's opaque IDs as returned; never infer IDs from list position.

The socket client writes one newline-delimited JSON request with a unique ID, buffers fragmented responses, validates the matching response ID, and closes each request connection on success/error/timeout. Bound request/response sizes, line counts, and operation durations; agent startup needs a longer timeout than a snapshot. Preserve meaningful Herdr error codes, including unsupported methods and blocked-agent errors.

## App screens

### Connect

Bridge URL, password-style token field, connect button, and short Tailscale instructions. Errors appear inline or in a native in-app Modal. Show a useful network/offline message, including the saved host, without displaying credentials.

### Agents

Dark, compact interface suitable for a phone, with large touch targets and clear typography. Show host connection state, workspace filters, agent name/type, working directory, and semantic state: working, idle, blocked, done, or unknown. Include a search field, empty/loading/error states, and manual refresh. A secondary pane list exposes available shells for starting an agent.

### Agent detail

Show the selected agent's identity and state above a selectable monospace output view. Support visible-screen versus recent-output reading. Preserve the user's scroll position when reviewing older output; offer a jump-to-latest control. Show a last-updated indicator.

A multiline composer sends prompts only on explicit tap. A compact terminal key toolbar provides Enter, Escape, Tab, arrows, and Ctrl+C. These controls support approval/question screens without automatically answering them. The user can enter text for interactive replies through explicit terminal input if needed. Keep prompts targeted to the selected agent/pane.

After sending, clear the composer only when the bridge acknowledges success. Never automatically replay a mutation after a network timeout: the prompt may already have reached Herdr. Explain uncertain delivery and allow the user to inspect refreshed output before retrying.

### Start agent

A native in-app modal selects an existing pane and supported agent kind, and collects a unique valid name. Show the pane's workspace and directory. Surface startup readiness/errors from Herdr. No automatic agent launch on connect or screen navigation.

## Refresh and lifecycle

Start with foreground polling: snapshot approximately every three seconds and selected output every one to two seconds, with one scheduled request of each kind in flight. Pause while the app is backgrounded and refresh on resume. Use authoritative snapshots after reconnecting and clear target-specific state when changing hosts or agents. Ignore stale responses when the target changes. Explicit refresh can supersede a pending read; see docs/review.md for the bounded concurrency limitation. Failed queries use bounded backoff; mutations never retry automatically.

Foreground polling avoids an unnecessary second streaming protocol for the first version. Android push notifications and continuous background monitoring are outside this version.

## Packaging and operation

Use Expo prebuild for Android and a standalone release APK with the JavaScript bundle included. Expo Go and development builds remain available through npm scripts. React Native fetch handles private HTTP endpoints; configure Android cleartext traffic through Expo app configuration. Use native primitives and lucide-react-native icons rather than web-only shadcn components.

Provide root npm scripts for dev, lint:fix, typecheck, tests, Expo export, prebuild, and Android APK build. Document the resulting APK location. Include a user service example for keeping the bridge available and a tmux dev.sh launcher. Secrets and generated build output stay ignored.

## Verification and acceptance

- Protocol tests with a mock Unix socket: split response chunks, daemon errors, invalid JSON, wrong IDs, socket closure, timeouts, size limits, and ambiguous mutation delivery.
- GraphQL tests: unauthorized requests rejected before daemon access; resolver validation and explicit method mapping; authentication and error messages do not expose secrets.
- UI behavior checks: pairing failure/success, workspace filtering, target changes, prompt success/error handling, blocked states, offline recovery, background polling pause, and no mutation retries.
- Run formatting/lint fixes, type checks, meaningful tests, Expo export, Android compilation, and inspect the app at phone dimensions.
- Validate against the installed schema. Live read-only integration checks may run against the user's daemon as authorized by the app task. Do not send prompts, interrupts, or startup actions to existing agents as a test.
- If mutation integration requires a real daemon, use a separately named disposable Herdr test session. Do not stop or restart the user's active session.
- Produce an APK that can be installed on Android 13. ADB installation/launch on the connected phone is a separate final device action after the build is reviewable.

Success means the built app can pair with the local bridge over Tailscale and the control path is validated, with any device/network validation limits clearly documented.
