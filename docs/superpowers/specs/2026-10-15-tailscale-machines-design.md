# Tailscale discovery and saved machines

Status: approved by the user on October 15, 2026. Implement in the existing workspace.

## User outcome

Discover computers visible through the connected machine's Tailscale network, pair with additional Herdr Mobile bridges, and switch between saved machines without retyping their credentials. Preserve the current single-machine connection when upgrading.

## Design

- Add a native Machines route, reachable from the agent list's host selector and connection settings. It lists saved profiles, highlights the active host, supports switching/removing a profile, and offers Add manually and Discover on Tailscale.
- Discovery runs on the currently connected bridge using `tailscale status --json`. The Android app cannot invoke the separate Tailscale app's CLI. First pairing remains manual; discovery requires one reachable authenticated bridge.
- The authenticated GraphQL query exposes only peer ID, display name, DNS name, Tailscale IP addresses, OS, online state, and whether the peer is the current host. Do not expose users, public keys, public endpoints, traffic statistics, or credential material from the CLI output.
- Show all peers visible to the bridge, including offline devices. Label discovery as visibility from the connected machine: tailnet ACLs may make phone reachability different. Discovery does not assert that a Herdr bridge is installed or perform automatic installation.
- Selecting a peer prefills its bridge address with a Tailscale IP and port 8787. The user supplies a display name and that host's pairing token and can change the address/port. Pairing verifies the remote session before saving.
- Each host needs Herdr, Tailscale, and this project's bridge running. No remote SSH, Tailscale admin API credential, subnet scanning, or unauthenticated host data endpoint.
- Store a versioned SecureStore index containing only profile IDs and the active ID. Store each complete profile, including its token, in its own SecureStore entry. Bound profile names, addresses and tokens so individual entries stay small; limit the index to 20 saved machines. Never render or serialize tokens into discovery results, route parameters or diagnostics.
- Migrate the existing `herdr.connection.v1` value only after the new profile/index have been persisted successfully; then delete the legacy entry. Use copy-on-write entries and make the index write the commit point, so a failed save cannot destroy a previous connection. Serialize store writes to avoid competing add/switch/remove actions.
- Deduplicate profiles by normalized bridge origin. Re-pairing the same origin updates its token/name. Distinct host profiles have independent credentials.
- Switching stops the previous Apollo client, resets host-specific UI state and returns to the agent list. Agent/pane IDs are scoped to a host. Never reuse a pending action or output from a previous host after switching.
- Removing the active host selects another saved host or returns to first pairing if none remain. Removing a profile does not stop its agents or revoke its host token.
- Discovery failures preserve saved profiles, show an actionable error, and keep manual pairing available. Bound CLI duration/output and coalesce/cache discovery briefly to avoid process storms.

## Alternatives

Manual-only saved machines are simpler but do not satisfy automatic discovery. Direct phone network scanning lacks access to the Tailscale peer inventory and scales poorly across the tailnet address range. Using the paired bridge provides names and peer visibility without another account/API credential.

## Verification

- Unit tests for Tailscale status parsing, malformed/absent data, offline peers, private-field omission, CLI errors, bounded execution and discovery cache behavior.
- GraphQL authentication tests prove discovery cannot run before authorization.
- Storage tests cover legacy migration, per-profile tokens, deduplication, switching, removing the active profile, and interrupted writes without losing existing credentials.
- App lifecycle/host identity checks guard against stale Apollo data/actions on a machine switch.
- Lint, TypeScript, complete test suite, Android bundle export, standalone APK build and native emulator checks for add/switch/remove and preserved legacy pairing.
- Real peer discovery can be checked against the local Tailscale inventory. Do not contact or control other machines without an intentional pairing action.

Implementation files: `bridge/src/discovery.ts`, schema/server integration; `mobile/src/lib/machines.ts` and profile persistence; SessionProvider; Machines route/screen and pairing UI; affected AGENTS.md/README and verification notes.
