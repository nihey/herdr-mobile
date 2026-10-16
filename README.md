# Herdr Mobile

An Expo Android companion for [Herdr](https://github.com/herdrdev/herdr). Check agent status, read terminal output, send prompts, respond to approval screens with terminal keys, and start agents in existing available panes. Discover Tailscale devices and save multiple independently paired machines.

See [screenshots and verification](docs/verification.md) for the built APK and native app checks.

The app connects over Tailscale to a small authenticated GraphQL bridge on your computer. The bridge uses Herdr's existing local Unix socket. Agents continue running when the phone disconnects.

For credential handling, safe publishing and security reports, see [SECURITY.md](SECURITY.md).

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

Open Herdr on Android, enter that address and token, then tap **Connect to Herdr**. Neither an Expo account nor a public hosting service is required to use a locally built APK.

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

Output: `artifacts/herdr-mobile.apk`. This is a standalone release-mode APK with its JS bundle included, signed using the generated Android debug key for personal sideloading. The default architecture is arm64-v8a. Use `ANDROID_ARCHITECTURES=arm64-v8a,x86_64 npm run build:android` for an emulator-compatible APK, or include all supported architectures if needed.

Install by copying the APK to your phone and opening it, or with a connected USB device:

```bash
adb install -r artifacts/herdr-mobile.apk
```

Native projects are generated from `mobile/app.json`. Do not edit generated Android files. To create a signed distributable through EAS, run `npx eas-cli@latest build --platform android --profile preview` from `mobile/` after configuring your own Expo project. `production` builds an AAB. The local APK is intended for personal use; retain your signing key if you plan to distribute updates.

## Using the app

- **Agents:** filter by workspace or directory/name, see working/idle/done/needs-input state, and tap an agent to inspect its terminal. Status is Herdr's detection; inspect the screen before acting on an unexpected question.
- **Recent output / Visible screen:** choose unwrapped recent output or the current rendered terminal screen. Select/copy terminal text. Scrolling up pauses following the latest output; tap **Latest** to resume.
- **Prompt:** explicitly sends the text plus Enter. **Type text:** writes literal terminal text without Enter, useful for interactive responses. Use the key toolbar to finish a reply or navigate a question. The app does not automatically answer approvals.
- **Ctrl+C** sends an interrupt to the selected terminal. It can stop the foreground task.
- **Other terminals:** inspect a shell or unrecognized process. **Start an agent here** launches an installed agent CLI in that explicit pane; Herdr verifies availability. Enter a unique lowercase agent name and a Herdr agent kind.
- Foreground state/output refresh approximately every 3/1.5 seconds, with bounded backoff on failures. Background polling pauses. No push/background notifications in this version.
- A disconnected mutation is never retried automatically. If delivery is uncertain, inspect refreshed output before sending it again. Failed sends retain your draft.
- **Settings → Forget connection** removes the active saved profile. **Manage machines** offers confirmed removal and switching; other saved profiles remain available.

## Keep the bridge running

For development, use the tmux launcher. For longer-term use, adapt `bridge/herdr-mobile.service.example` into `~/.config/systemd/user/herdr-mobile.service`, build the bridge, and run `systemctl --user enable --now herdr-mobile`. Replace the example checkout and Node paths first. Start Herdr normally; this bridge never starts/stops your existing daemon. The user service restarts if Tailscale is temporarily unavailable.

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
- **Local build SDK error:** set `ANDROID_HOME` to your SDK and install SDK 36 plus any SDK/NDK components requested by Gradle. Gradle downloads its toolchain on the first build.

HTTP is enabled in Android so tailnet addresses work directly. Tailscale encrypts traffic between tailnet devices; use an HTTPS endpoint for connections outside that network. The bridge has no unauthenticated data operations, arbitrary shell API, or Herdr shutdown endpoint.
