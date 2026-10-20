# Herdr Mobile

An Expo Android companion for [Herdr](https://github.com/herdrdev/herdr). Check agent status, read terminal output, send prompts, respond to approval screens with terminal keys, and start agents in existing available panes. Discover Tailscale devices and save multiple independently paired machines.

The Android app is named **Herd Remote** (package `io.github.nihey.herdremote`). It is an unofficial companion and is not affiliated with the Herdr project.

See [screenshots and verification](docs/verification.md) for the built APK and native app checks.

The app connects over Tailscale to a small authenticated GraphQL bridge on your computer. The bridge uses Herdr's existing local Unix socket. Agents continue running when the phone disconnects.

For credential handling, safe publishing and security reports, see [SECURITY.md](SECURITY.md). The app's privacy policy is [PRIVACY.md](PRIVACY.md).

```text
Android app → Tailscale → GraphQL bridge :8787 → Herdr Unix socket
```

## Requirements

- Node.js 22.13+ and npm.
- A running Herdr server (developed against 0.9.4, public JSON API/protocol 22).
- Tailscale on your computer and phone, joined to the same tailnet. Your tailnet ACL must allow the phone to reach the computer on TCP 8787.
- Android 7+; local builds need a full JDK 17+ (including `javac`) and the Android SDK. The build script discovers the installed Android Studio JDK when the system Java has no compiler. Set `JAVA_HOME` to override it.

## Start the bridge

```bash
npm install
npm run build:bridge
npm start -w bridge
```

The bridge discovers your Tailscale IPv4 and listens there on port 8787. It does not expose a public listener by default. Keep this process running while using the app.

In a second terminal, show your pairing settings:

```bash
npm run pairing -w bridge
```

Use the bridge URL printed by the pairing command (`http://<your-tailscale-ip>:8787`); verify your address with `tailscale ip -4`. The pairing command prints the token locally. Do not share it: it authorizes control of this Herdr session. Token generation is automatic; `.local/pairing-token` is ignored and restricted to its owner. The app saves credentials in Expo SecureStore.

Open Herd Remote on Android, enter that address and token, then tap **Connect to Herdr**. Neither an Expo account nor a public hosting service is required to use a locally built APK.

## Discover and add other machines

1. Pair your first computer manually using the steps above.
2. Tap the machine name below the Herdr header, or **Settings → Manage machines**.
3. Tap **Discover devices** to list the Tailscale peers visible to that connected computer. Names, OS, private addresses and online status come from its local Tailscale inventory.
4. Tap **Add <device>**. The app prefills its address (port 8787); enter a display name and the pairing token from that computer's bridge, then tap **Verify and add machine**.
5. Use the **Your machines** screen to switch between saved profiles or remove one. You can also **Add manually**, including when the current bridge is offline.

Every computer needs its own running Herdr server and Herdr Mobile bridge. Copy this checkout to that machine, install/build/start its bridge, and run `npm run pairing -w bridge` there to get its token. Discovery lists devices; it does not install software remotely. A device being online in Tailscale does not prove that it has a bridge or that your phone can reach it. Tailnet ACLs/firewalls must allow phone → computer TCP 8787.

On each computer, check `herdr status server` for the socket path. Set `HERDR_SOCKET_PATH` in its bridge configuration if the platform or named session uses a different path from the default.

Discovery runs the local `tailscale status --json` command on the paired bridge, not a phone subnet scan. It needs no Tailscale admin API key and returns no users, keys, public endpoints or traffic statistics. Results are cached for up to 10 seconds. If discovery says the bridge needs updating, rebuild/restart that bridge; manual pairing remains available.

Machine tokens are stored separately in Expo SecureStore; up to 20 profiles are supported. Upgrading from 0.1.0 migrates the existing pairing automatically. Saving the same normalized bridge address updates its profile. Different addresses or DNS aliases are separate profiles, even if they refer to one computer.

Selecting a machine resets its agent list/output, and pane IDs are always scoped to that profile. Removing a profile leaves its agents running; removing the active profile selects another saved machine or returns to initial pairing. It does not revoke the bridge token on the computer.

Optional configuration goes in `bridge/.env` (copy from `bridge/.env.example`). For localhost testing set `HERDR_MOBILE_HOST=127.0.0.1`. For a named session set `HERDR_SOCKET_PATH` to its socket path. Defaults point to the installed user's `~/.config/herdr/herdr.sock`. Token rotation: stop the bridge, delete `.local/pairing-token`, restart, and re-pair the app. Explicit environment tokens must be at least 32 characters.

## Run with Expo

```bash
npm start -w mobile
```

Open the displayed QR code with a compatible Expo Go version on Android. Both devices must be able to reach Metro (port 8081) as well as the bridge. For remote tailnet development, set `REACT_NATIVE_PACKAGER_HOSTNAME` to your computer's Tailscale IP before starting Expo. A standalone APK only needs the bridge and Tailscale; Metro is unnecessary.

`./dev.sh` launches the bridge and Metro in tmux split panes.

## Build an installable APK locally

```bash
npm run build:android
```

Output: `artifacts/herdr-mobile.apk`. This is a standalone release-mode APK with its JS bundle included. It is signed with your private upload key when `.local/upload-keystore.properties` exists (see below). Otherwise it uses React Native's public debug key, which is suitable only for personal sideloading. The default architecture is arm64-v8a. Use `ANDROID_ARCHITECTURES=arm64-v8a,x86_64 npm run build:android` for an emulator-compatible APK, or include all supported architectures if needed.

Install by copying the APK to your phone and opening it, or with a connected USB device:

```bash
adb install -r artifacts/herdr-mobile.apk
```

### Test builds over the air

Firebase App Distribution is the Android counterpart to TestFlight and accepts the APK as is; the app needs no Firebase SDK or `google-services.json`. In your own Firebase project, register an Android app with package `io.github.nihey.herdremote`, create a tester group, then bump `version`/`versionCode` in `mobile/app.json`, build, and drop `artifacts/herdr-mobile.apk` on App Distribution › Releases (or run `firebase appdistribution:distribute artifacts/herdr-mobile.apk --app <firebase-app-id> --groups <group-alias>`). Testers accept the emailed invite and install updates through the Firebase App Tester app. An update installs only when it has the same signing key, so build test APKs with the upload key before inviting other people.

### Publish to Google Play

Play requires an App Bundle signed with a private upload key. Create the key once and keep both files out of Git (`.local/` is ignored):

```bash
umask 077
keytool -genkeypair -keystore .local/upload-keystore.jks -storetype PKCS12 -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Herd Remote upload key"
printf 'storeFile=%s\nstorePassword=<password>\nkeyAlias=upload\nkeyPassword=<password>\n' \
  "$PWD/.local/upload-keystore.jks" > .local/upload-keystore.properties
```

Back up both files privately. Play App Signing holds the key that signs the installed app. If you lose the upload key, Play support can reset it, but you can't upload updates until it does.

```bash
npm run build:android:bundle
```

Output: `artifacts/herdr-mobile.aab`, covering all four Android ABIs. The build script passes the key to Gradle through the environment, so passwords never appear in process arguments. Bump `version` and `versionCode` in `mobile/app.json` for every upload. Upload the bundle in Play Console › Test and release, starting with internal testing. Use [PRIVACY.md](PRIVACY.md) on GitHub as the privacy policy URL.

Native projects are generated from `mobile/app.json`. Do not edit generated Android files. To create a signed distributable through EAS, run `npx eas-cli@latest build --platform android --profile preview` from `mobile/` after configuring your own Expo project. `production` builds an AAB. The local APK is intended for personal use; retain your signing key if you plan to distribute updates.

## Using the app

- **Agents:** filter by workspace or directory/name, see working/idle/done/needs-input state, and tap an agent to inspect its terminal. Status is Herdr's detection; inspect the screen before acting on an unexpected question.
- **Recent / Screen:** choose unwrapped recent output or the current rendered terminal screen. Select/copy terminal text. Scrolling up freezes the text where you are reading (**PAUSED**) while the agent keeps working; the pill counts new lines. Tap it or scroll to the bottom to resume following.
- **Prompt:** explicitly sends the text plus Enter. **Type text:** writes literal terminal text without Enter, useful for interactive responses. Use the key toolbar to finish a reply or navigate a question. The app does not automatically answer approvals.
- **Dictation:** tap the mic beside the composer and speak; words appear in the draft as you talk. Tap ■ to stop, review, then send. Nothing is sent automatically. The **EN/PT** chip picks English or Brazilian Portuguese before you speak and is remembered. Recognition runs only on the phone through Android's on-device speech engine (Android 13+); the first use of each language offers Android's one-time offline model download. Audio and transcripts never go to the bridge or any cloud service.
- **Ctrl+C** sends an interrupt to the selected terminal. It can stop the foreground task.
- **Other terminals:** inspect a shell or unrecognized process. **Start an agent here** launches an installed agent CLI in that explicit pane; Herdr verifies availability. Enter a unique lowercase agent name and a Herdr agent kind.
- Foreground state/output refresh approximately every 3/1.5 seconds, with bounded backoff on failures. Background polling pauses. No push/background notifications in this version.
- A disconnected mutation is never retried automatically. If delivery is uncertain, inspect refreshed output before sending it again. Failed sends retain your draft.
- **Settings → Forget connection** removes the active saved profile. **Manage machines** offers confirmed removal and switching; other saved profiles remain available.

## Keep the bridge running

For development, use the tmux launcher. For longer-term use, adapt `bridge/herdr-mobile.service.example` into `~/.config/systemd/user/herdr-mobile.service`, build the bridge, and run `systemctl --user enable --now herdr-mobile`. Replace the example checkout and Node paths first. To start it at boot rather than at your first login, run `loginctl enable-linger "$USER"` once. After changing bridge code, run `npm run build:bridge && systemctl --user restart herdr-mobile`; check it with `journalctl --user -u herdr-mobile`. Start Herdr normally; this bridge never starts/stops your existing daemon. The user service restarts if Tailscale is temporarily unavailable.

## Checks

```bash
npm run lint:fix
npm run typecheck
npm test
npm run integration
npm run build:bridge
npm run export:android -w mobile
```

Tests exercise socket framing, daemon errors, correlation, disconnect/timeout handling, size limits, authentication before daemon access, GraphQL mapping/validation, and URL normalization. Mutation tests use a fake socket or an isolated test session, never existing user agents.

`npm run integration` requires the installed `herdr` executable. It creates a unique disposable named server, exercises GraphQL snapshot/input/keys/output end to end, and stops only that test server.

## Troubleshooting

- **Cannot reach bridge:** verify Tailscale is connected on both devices, the bridge process is running, the saved IP/port are correct, and the tailnet ACL/firewall permits TCP 8787. Check `tailscale status` and `tailscale ping <computer>`.
- **Token rejected:** show the current pairing token locally and re-pair. Installing a different signed build or rotating the bridge token can require re-pairing.
- **Herdr unavailable:** confirm `herdr status server` and the configured socket path. Named sessions use different sockets. Run the bridge as the same user as Herdr.
- **Agent blocked:** inspect the visible screen, switch to Type text, and use logical terminal keys to answer intentionally.
- **No such agent / pane:** refresh the list; panes may have closed or moved. Cross-workspace moves change public pane IDs.
- **Start timeout or uncertain delivery:** inspect the pane before retrying; the agent may still have started.
- **Dictation unavailable:** grant the microphone permission (Android Settings › Apps › Herd Remote › Permissions). If the download prompt keeps returning, check the language under Settings › Android System Intelligence › On-device speech recognition, or update Speech Recognition & Synthesis from Google Play.
- **Local build SDK error:** set `ANDROID_HOME` to your SDK and install SDK 36 plus any SDK/NDK components requested by Gradle. Gradle downloads its toolchain on the first build.

HTTP is enabled in Android so tailnet addresses work directly. Tailscale encrypts traffic between tailnet devices; use an HTTPS endpoint for connections outside that network. The bridge has no unauthenticated data operations, arbitrary shell API, or Herdr shutdown endpoint.
