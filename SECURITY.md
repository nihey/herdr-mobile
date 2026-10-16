# Security

## Credentials and network access

The bridge controls the local user's Herdr session. Keep its pairing token private and restrict TCP 8787 to trusted devices through your Tailscale ACL and firewall. The default listener binds only to the local Tailscale IPv4. Use HTTPS for connections outside the encrypted tailnet.

Tokens are generated independently on each computer and stored in ignored `.local/pairing-token` files with mode 0600. An explicit `HERDR_MOBILE_TOKEN` or `HERDR_MOBILE_TOKEN_FILE` can override this configuration. The Android app stores per-machine credentials in Expo SecureStore; no host address or token is compiled into the app.

All GraphQL operations require a bearer token before accessing Herdr or Tailscale. Discovery returns a limited peer inventory to authenticated clients. This is a single-user bridge: anyone with its token has access to the same local Herdr session.

To rotate a generated token, stop the bridge, delete `.local/pairing-token`, restart the bridge and pair the app again. If you use an explicit environment token, replace that value instead. Removing an app profile does not revoke the token on the computer.

## Publishing source and screenshots

- Keep `.env` files, pairing tokens, signing keys, service credentials, APKs, build output and scan reports out of Git. `.env.example` files must contain placeholders only.
- Use fictional machine names and example addresses in fixtures and documentation. Obtain the real bridge URL with `npm run pairing -w bridge` locally.
- Capture screenshots only from disposable test sessions. Never publish real terminal output, prompts, peer inventories or filled credential fields.
- Use a GitHub noreply commit email when your personal email should remain private. Review author and committer metadata as well as file contents.
- Scan the full history with a secret scanner such as Gitleaks before changing visibility or publishing a release. Review image contents separately. Deleting a file in the latest commit does not remove it from earlier commits.
- If a credential ever reaches GitHub, revoke or rotate it first. History rewriting alone cannot guarantee removal from existing clones, forks or cached views.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option in this repository's Security tab. Include a minimal reproduction with fake credentials and a disposable Herdr session. Do not post real pairing tokens, terminal content or unredacted tailnet details in public issues.
