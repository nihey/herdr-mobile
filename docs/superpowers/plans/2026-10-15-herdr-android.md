# Herdr Expo Android Implementation Plan

> Execute inline using superpowers:executing-plans. Keep this checklist current.

**Goal:** Deliver an Expo Android companion that controls the existing Herdr daemon through an authenticated GraphQL bridge over Tailscale.

**Architecture:** npm workspaces `mobile` and `bridge`. Native React Native components, Expo SecureStore, Apollo Client 4; explicit GraphQL resolvers map to newline-delimited JSON Unix socket requests.

**Tech Stack:** Expo, React Native, React 19, TypeScript, Apollo Client, GraphQL Yoga, Node.js ESM, Vitest, ESLint, Prettier.

### 1. Scaffold and protocol contract

- [x] Initialize root npm workspaces and Expo TypeScript template; add shared lint/format/typecheck commands.
- [x] Write socket client tests in `bridge/src/socket.test.ts`: fragmented frames, daemon errors, wrong response IDs, disconnect, timeout, invalid JSON, and response limit.
- [x] Run `npm test -w bridge` and confirm missing socket behavior fails.
- [x] Implement `HerdrClient.request` in `bridge/src/socket.ts` with request IDs, bounded reads, timeout cleanup, no automatic mutation retries.
- [x] Rerun protocol tests.

### 2. Authenticated GraphQL bridge

- [x] Write HTTP integration tests in `bridge/src/server.test.ts` with a disposable mock Unix socket: unauthenticated access cannot open the socket; snapshot/read succeed; prompt targets are explicit; invalid keys and startup names fail; errors preserve safe codes.
- [x] Implement `bridge/src/schema.ts`, `bridge/src/server.ts`, and `bridge/src/index.ts` for explicit schema, resolver mapping, bearer authentication, bounded requests, Tailscale bind discovery, local token generation, and graceful termination.
- [x] Run `npm test -w bridge` and `npm run typecheck -w bridge`.
- [x] Add `bridge/.env.example`, `bridge/AGENTS.md`, and user service example.

### 3. Expo connection and interaction state

- [x] Add tests for `mobile/src/lib/connection.ts`: trim/normalize valid HTTP and HTTPS origins, reject credentials/query/fragments/invalid URLs, reject empty tokens.
- [x] Implement URL validation and SecureStore connection persistence; Apollo Client configured with bearer authentication, bounded fetch timeout, and no mutation retry link.
- [x] Implement `mobile/src/hooks/useSession.ts` and `useOutput.ts` using foreground-only polling, clearing stale target state and preserving uncertain-send errors.
- [x] Run `npm test -w mobile` and TypeScript checks.

### 4. Native interface

- [x] Implement `mobile/src/components/ui.tsx`: accessible native buttons, fields, state badges, modal/error views, theme tokens.
- [x] Implement `mobile/src/screens/ConnectScreen.tsx`, `AgentsScreen.tsx`, `AgentScreen.tsx`, and `StartAgentModal.tsx`: saved host, pairing, workspace/search filters, pane list, output source/scroll controls, composer, key controls, explicit startup.
- [x] Implement `mobile/src/app/_layout.tsx` lifecycle/navigation and safe-area/keyboard handling.
- [x] Set Android app identity, icons, SecureStore plugin, cleartext traffic, and EAS preview APK profile in Expo config.
- [x] Export the Android JS bundle and inspect native runtime on an emulator when available.

### 5. Integration, packaging, documentation

- [x] Add root/subproject AGENTS.md, README.md, .env.example files, dev.sh, build script and ignored secret/build paths.
- [x] Run root `npm run lint:fix`, `npm run typecheck`, and `npm test`.
- [x] Exercise real protocol and mutation flow against a disposable named Herdr session, leaving existing agents untouched.
- [x] Generate native project with `npx expo prebuild --platform android`; build standalone APK with Gradle, verify package metadata.
- [x] Review final implementation against design and record actual verification and any unresolved limits.

## Verification outcome

Source and standalone APK delivered. See `docs/verification.md` for actual checks and test boundaries, and `docs/review.md` for minor observations. Native UI was verified through emulator interaction rather than shallow implementation-mirroring component tests. Physical phone/tailnet reachability remains a device setup step.
