# Manual tests

Scripts that exercise the gateway against the **real Gong API** with real
credentials. They are intentionally outside `src/` so neither `npm test`
(globs `src/**/*.test.ts`) nor `tsc` (includes `src/` only) ever touches
them — they must never run in CI.

All scripts are read-only: no write endpoint is called.

## policy-smoke.ts

End-to-end verification of the Phase 3 policy layer for a real user: resolves
their Gong permission profile into a `UserPolicy`, then compares the raw
org-wide client against the `PolicyGongClient` — calls visibility (both
directions), cross-workspace fail-closed, stats scoping, AI-tool gating, and
the capability-gated admin surface.

```bash
npm run smoke:policy                          # default persona
npm run smoke:policy -- caio.pereira@gonimbly.com
```

Credentials: either `GONG_ACCESS_KEY`/`GONG_ACCESS_KEY_SECRET`/`GONG_BASE_URL`
env vars, or a keychain OAuth token from a prior `gong_login` (local dev).

Run it for each persona in `docs/phase3a-discovery.md` before flipping
`GONG_POLICY_MODE=profiles` (phase 3e), and again whenever the resolver or
policy client changes. It exists because live APIs disagree with fakes:
on 2026-06-11 it caught `/v2/users/extensive` rejecting the bare `{}` body
our unit-test fake accepted, which silently degraded every session.
