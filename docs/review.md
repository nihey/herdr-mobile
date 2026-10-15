# Final code review

Independent read-only review covered bridge authentication, installed Herdr protocol 22 mappings, explicit target handling, credential storage, polling, Android config, build scripts, and documentation. No critical or important findings.

Deferred minor observations:

- Pull-to-refresh does not animate the spinner after the first load, although refresh still runs.
- Requests from an unfocused/replaced polling effect finish or time out rather than being cancelled. Their results are ignored. Normal scheduled reads do not overlap; repeated explicit refreshes can leave earlier reads in flight for up to the bounded network timeout.

These observations do not cause stale output to overwrite a new target or replay any mutation. Cancellation and refresh indicator polish can be added separately.

## Tailscale machines review

An independent read-only review checked discovery authentication/privacy, CLI limits, serialized storage commits, migration failures and machine-scoped routes/actions. No critical finding.

One important compatibility edge was found and fixed: valid legacy hostnames longer than 64 characters must retain their full URL while using a shortened generated display name. A migration regression test failed before the fix and passed afterward. Generated names in first pairing and discovered peer forms use the same display-name bound.

Native regression testing also caught Android Back exiting instead of navigating. Keeping predictive-back mode disabled and using a focused home-back handler passed the installed-APK regression for both agent and Machines screens.
