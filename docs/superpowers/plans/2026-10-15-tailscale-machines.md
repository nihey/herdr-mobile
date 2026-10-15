# Tailscale Machines Implementation Plan

> Execute inline using the executing-plans workflow; use a final independent code review.

**Goal:** Discover Tailscale peers from a paired bridge and save/switch independently authenticated machine profiles in the Expo app.

**Architecture:** An authenticated GraphQL discovery query runs a bounded local Tailscale CLI call. A storage adapter keeps a small SecureStore index and immutable per-profile credential records. SessionProvider binds Apollo/UI state to the active profile.

**Tech Stack:** Existing TypeScript, GraphQL Yoga, Apollo Client 4, Expo Router, SecureStore, React Native, Vitest. No new packages.

### 1. Discovery

- [x] Add `bridge/src/discovery.test.ts` covering parser field projection, IP validation, self/offline peers, invalid/unavailable status, CLI failures, shared in-flight reads, and cache expiry. Run `npx vitest run bridge/src/discovery.test.ts` and observe missing behavior fail.
- [x] Implement `parseTailscaleStatus(value: unknown): DiscoveredMachine[]` and `createDiscovery(): () => Promise<DiscoveredMachine[]>` in `bridge/src/discovery.ts`. Use `execFile('tailscale', ['status', '--json'], { timeout: 4000, maxBuffer: 2 * 1024 * 1024 })`; expose safe errors, cache successes for 10 seconds and coalesce in-flight calls.
- [x] Add `discoveredMachines` to the explicit schema; inject discovery into createBridge/buildSchema and wire the default implementation in index.ts. Extend `bridge/src/server.test.ts` for authentication before discovery and safe failure codes. Run bridge tests and typecheck.

### 2. Profile storage

- [x] Add `mobile/src/lib/machines.test.ts` covering v1 migration, index/token separation, normalized-origin deduplication, active selection, removal, write failure preservation, serialization, size/count bounds, and corrupt storage recovery.
- [x] Implement `MachineStore` in `mobile/src/lib/machines.ts` over `{getItemAsync,setItemAsync,deleteItemAsync}`. Persist a new profile record first, then commit the versioned index; discard superseded entries only after commit. Serialize load/add/activate/remove operations. Run the focused suite.

### 3. Connection and UI

- [x] Replace single-connection persistence in `mobile/src/lib/session-context.tsx` with MachineStore state. Verify a remote SESSION before adding; support display name, activate/remove, loading errors and busy state. Stop the old Apollo client before publishing a host switch.
- [x] Key host-specific content and the navigator by active profile; ensure a stale agent route cannot be used against another host. Keep existing manual first pairing.
- [x] Add `mobile/src/screens/MachinesScreen.tsx`, `PairMachineModal.tsx` and `mobile/src/app/machines.tsx`. Include saved profiles, manual pairing, explicit discovery, peer status/details, token entry, host switching and confirmed removal. Use native UI primitives and existing theme.
- [x] Add host selector/settings navigation in AgentsScreen; add DISCOVER query/types and useful unsupported-bridge errors. Keep manual add available offline. Run TypeScript/lint and Android bundle export.

### 4. Documentation and verification

- [x] Update root/subproject AGENTS.md and README for discovery setup, independent host credentials, migration and limits. Add actual evidence to docs/verification.md.
- [x] Run lint:fix, typecheck, full tests, integration and Expo Doctor. Review source independently; fix concrete important findings with regression tests.
- [x] Build version 0.2.0 / Android versionCode 2 standalone APK. Verify signing-key compatibility with the previous APK and test upgrade, migration, discovery, two-host switching and removal in the emulator against isolated test bridges. Leave the real bridge running with the updated schema; do not control other tailnet machines.

Progress and decisions: docs/implementation-ledger.md.

## Outcome

Version 0.2.0 APK delivered. Source checks: 49 tests, TypeScript/lint/format and Expo Doctor 21/21. Native upgrade/migration, authenticated discovery, per-host pairing, identical-pane-ID switching, profile removal/persistence and hardware Back checks passed. Review and actual evidence are in docs/review.md and docs/verification.md. The production bridge was updated and returns 9 visible tailnet devices without contacting them.
