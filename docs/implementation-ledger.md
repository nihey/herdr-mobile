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
