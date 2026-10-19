This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Herdr app architecture

- Expo 57 / React Native 0.86, React 19.2.3. Root npm overrides pin React, Reanimated and Worklets to one SDK-compatible version; run Expo Doctor after dependency changes.
- Routes: `src/app/_layout.tsx`, `index.tsx`, `agent/[paneId].tsx`. Screen components live under `src/screens`; no web Server Components or DOM elements.
- `src/lib/session-context.tsx` owns SecureStore credentials and the connection-specific Apollo Client. Tokens must never appear in route parameters, logs, screenshots, or compiled environment variables.
- `src/lib/machines.ts` owns versioned machine storage through an injected storage adapter. A token lives only in its separate profile entry; the v2 index contains IDs/active ID. Migrate v1 after a successful v2 commit. Serialize writes, bound entry bytes and profile count, and deduplicate normalized origins.
- `src/app/machines.tsx` / MachinesScreen provide saved-host switching, authenticated peer discovery, manual pairing and removal confirmation. PairMachineModal probes SESSION before saving; each bridge has its own token. First pairing remains manual.
- Agent routes include `machineId`; a mismatch with the active profile redirects home. Home/Machines/Agent screen state is keyed by active profile so pane IDs and outputs never cross hosts.
- `src/lib/graphql.ts` contains explicit GraphQL operations and a bounded fetch timeout. Mutations do not retry. `src/lib/errors.ts` distinguishes daemon errors from uncertain network delivery.
- `src/hooks/usePoll.ts` polls only focused foreground screens, with error backoff and stale-result suppression. Agent detail is keyed by host/pane/mode.
- Native UI primitives and theme live in `src/components/ui.tsx`. Use lucide-react-native icons and in-app Modal dialogs. Prompt sends text + Enter; Type text deliberately sends no Enter.
- Agent screen keeps the terminal as the main area: one-row header, Recent/Screen chips in the terminal bar, one swipeable key row and a single composer row (mode chip, input, send). Scrolling up freezes the shown output (PAUSED) so polling cannot slide text under the reader; a pill counts new lines via `src/lib/terminal.ts` and returning to the bottom resumes following. Programmatic scrolls are unanimated so they never trigger unfollow.
- Dictation (`src/hooks/useDictation.ts`, `src/components/DictationControl.tsx`, pure helpers in `src/lib/dictation.ts`) uses expo-speech-recognition with `requiresOnDeviceRecognition`: no network recognition fallback. EN (`en-US`) / PT (`pt-BR`) is chosen before speaking (Android 13 has no language detection) and stored in SecureStore as a non-secret preference. A missing offline model opens SpeechModelSheet, which triggers Android's model download. Dictated text only fills the draft: never auto-send, never log transcripts. Send cancels an active session and sends the visible draft.
- Android is edge-to-edge, so `adjustResize` no longer moves content: the agent screen's KeyboardAvoidingView uses `padding` on both platforms to keep the composer above the keyboard.
- `app.json` configures Android identity, SecureStore, Expo Router and private-network HTTP via expo-build-properties. `android/` is generated and ignored.
- Keep `android.predictiveBackGestureEnabled` false for the current native navigation stack. Agent/Machines screens use a focused BackHandler to return home; enabling predictive callbacks bypassed that JS behavior in Android emulator checks.
- Root `npm run build:android` builds a self-contained personal-use APK locally. EAS profiles in eas.json support separate cloud builds.
- Root tests cover pure connection validation plus bridge security/protocol. Run root lint/typecheck/tests and `npx expo-doctor` before finishing.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
