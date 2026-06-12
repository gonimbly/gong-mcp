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

Run it for each persona in `docs/phase3a-discovery.md` whenever the resolver
or policy client changes (`profiles` is the live default since 2026-06-12, so
these checks now guard a production access model). It exists because live APIs
disagree with fakes:
on 2026-06-11 it caught `/v2/users/extensive` rejecting the bare `{}` body
our unit-test fake accepted, which silently degraded every session.

## find-calls-smoke.ts

End-to-end verification of the call-discovery composite tools
(`src/gong/discovery.ts`) through a real `PolicyGongClient`: directory
resolution, participant search with an independent raw-fetch cross-check of a
result, account search seeded from live data, `my_calls` self-containment,
summary compactness, and a before/after token-cost comparison of the composite
output vs paging the raw extensive endpoint.

```bash
npm run smoke:find-calls                                        # default persona + "Nikki Mitchell"
npm run smoke:find-calls -- nikki.mitchell@gonimbly.com "Iulyan"
```

Run it after changing the discovery engine, and for at least one persona with
restricted call visibility to confirm policy composition (coverage counts must
satisfy matched ≤ scanned ≤ raw total).

## stats-coaching-probe.ts

One-shot probe of the stats + coaching endpoints, written when production
surfaced permanent 400s on 2026-06-12: date-only vs datetime expectations per
endpoint, the top-level `aggregationPeriod` field, and `/v2/coaching`'s
kebab-case `workspace-id`/`manager-id`/`from`/`to` contract. Re-run before
changing any stats/coaching request shape.

```bash
npm run probe:stats-coaching
```

## extensive-filter-probe.ts

One-shot probe of `/v2/calls/extensive` capabilities: `primaryUserIds` filter
support, `contentSelector.context: "Extended"` CRM shape and coverage, party
field shapes, deep-link presence, and missing/empty-filter strictness. Findings
are recorded in `docs/backlog-call-discovery-tools.md` — re-run it before
relying on a new request shape, and update that doc if Gong's behavior changes.

```bash
npm run probe:extensive-filter
```
