# Implementation ledger

- User chose Expo instead of Next/Capacitor; native UI and SecureStore replace web-specific conventions.
- Implementing inline in the initially empty workspace. Keep generated Android files ignored and reproduce through Expo config.
- Design and plan: `docs/superpowers/specs/2026-10-15-herdr-android-design.md`, `docs/superpowers/plans/2026-10-15-herdr-android.md`.
- Protocol authority: installed Herdr 0.9.4 schema, protocol 22; do not mutate existing agents during verification.
- Implemented socket client, authenticated GraphQL bridge, Expo Router screens, SecureStore/Apollo pairing, output/key/prompt controls, existing-pane startup, and operating/build docs.
- Verified: 25 tests pass; root TypeScript/lint checks pass; Expo Doctor 21/21; Android bundle exported; disposable-session live GraphQL snapshot→text→Enter→output passes.
- Build environment: system Java 21 is a JRE without javac; build script discovers Android Studio's full JDK. Root overrides/dedupe prevent transitive optional peers installing a second React/Worklets/Reanimated version.
- Independent review: no critical/important findings; two minor polling observations documented in docs/review.md. Native build completed successfully (879 Gradle tasks); standalone dual arm64/x86_64 APK is artifacts/herdr-mobile.apk. Package/signature verified: dev.herdr.mobile 0.1.0, min API 24 / target 36.
- Also verified the checks and isolated-session integration using Node 22.23.3. A controlled test process named codex in the separate UI session received an actual Herdr agent.prompt and returned output; no real AI provider was called.

- Native smoke checks passed: pairing, agent list/output, prompt acknowledgment and echo, SecureStore restore after force-stop, offline display and recovery. Screenshots and full verification evidence are in docs/verification.md.

## Tailscale machines extension

- User approved discovery through an already paired computer, per-host pairing tokens, saved profiles, and machine switching. First pairing remains manual.
- Implemented privacy-filtered cached discovery, explicit GraphQL auth, serialized copy-on-write SecureStore profiles with v1 migration, machine-scoped routes, Machines screen and verified pairing modal. No new dependencies.
- Tests written before implementation; focused failures observed, then fixed. 48 tests currently pass, TypeScript passes. Real local Tailscale discovery returned the expected inventory with only the allowed fields; no remote host contacted.
- Native version 0.2.0 / code 2 is compiling. Previous 0.1.0 APK retained locally for upgrade/migration checks. Final independent review is in progress.
- Review found a long-hostname v1 migration failure. Regression observed RED→GREEN; generated names are bounded while full URLs remain intact. Suite now passes 49 tests; Expo Doctor passes 21/21.
- Signed upgrade preserved pairing; native discovery, independent-token pairing, same-pane-ID host switching, removal and persistence checks passed using two isolated bridges. Bridge updated and authenticated discovery verified against the local inventory.
- Native Back behavior failed during the switch flow; added a focused back handler and rebuilt the bundle. Final installed-APK back regression remains pending.
- The JS back handler alone did not resolve native exit: the generated manifest enabled predictive OnBackInvoked callbacks. Restored Expo's default (predictiveBackGestureEnabled=false) so the current stack can use legacy BackHandler dispatch; rebuilding to rerun the native regression. Existing switching/pairing behavior remains verified.
- Final compatibility APK built successfully. Native regression passed for Back from both screens and removing the final profile. All machine-flow checks, migration, signatures, 49 automated tests and real bridge discovery are verified; see docs/verification.md. Physical-phone reachability to other tailnet hosts remains a setup check.

## New sessions and home UX (0.4.0)

- User story: away from home, could not start another agent in a project already open in Herdr because its only pane was busy. User chose a single floating New session button; the sheet asks project → agent → optional first task. Design: `docs/superpowers/specs/2026-11-02-new-session-ux-design.md`.
- Bridge: `startSession` (new unfocused tab in the project folder → shell wait → agent.start → readiness wait), `agentKinds`, `Workspace.cwd`; agent titles now map from `terminal_title_stripped` like panes. Tests written first; 81 pass.
- Live findings against Herdr 0.9.4: a new tab's shell runs its startup scripts (about 1.6 s with conda) and Herdr rejects agent.start with `agent_pane_busy` until the shell is alone in the foreground, so the bridge polls `pane.process_info` (read-only) instead of retrying. agent.start returns as soon as the process is seen (~0.1 s), before the agent accepts input (~4 s for the stand-in), so the bridge waits with `agent.wait` and reports `ready`.
- Incident: an early ad-hoc probe in a disposable named session used the developer's own interactive shell, whose startup scripts put the real Codex CLI ahead of the stand-in on PATH. One probe prompt ("hello") reached the real Codex CLI in /tmp before the session was stopped; two integration runs also launched it without delivering a prompt. No user session or agent was touched. The integration test and emulator environment now use `/bin/sh` with a restricted PATH, verify that agent names resolve to the stand-ins before starting anything, and only prompt after the stand-in's banner is visible.
