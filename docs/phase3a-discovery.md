# Phase 3a — Discovery findings (2026-06-11)

Pulled through the live gateway with the org credential: 2 workspaces, 13 permission
profiles (10 Customers + 3 People Ops), all profile→user mappings, and the full
manager graph (180 users, 174 with a `managerId`). Sanitized snapshots live in
`src/gong/__fixtures__/` (IDs only in the manager graph — no names/emails):

- `workspaces.json` — Customers + People Ops
- `profiles.customers.json` / `profiles.peopleops.json` — trimmed to the fields the
  resolver consumes (access levels + capability booleans). The Integration User
  fixture keeps only 4 of its 34 vestigial `teamLeadIds` (see Q6).
- `profileUsers.json` — profileId → member userIds
- `managerGraph.json` — `{ id, managerId, active }` for all 180 users

## Answers to the plan's open questions

1. **`report-to-them` with `teamLeadIds: null`** — interpreted as "transitive reports
   of the authorizing user themself". With explicit `teamLeadIds` (Collaborator), it is
   "transitive reports of those leads", *excluding* the leads themselves — the profile
   description says "most Delivery calls", and the three leads are the Delivery heads.
   Both interpretations are encoded in the resolver and flagged for the 3e UI A/B.

2. **Transitive vs direct reports** — implemented transitive (UI "team" semantics
   cascade). The graph is deep: one Delivery lead has 141 transitive reports vs 2–45
   for others, so the distinction matters. Verify against a second-level report in 3e.

3. **Private calls** — `privateCalls` is captured per profile into
   `capabilities.privateCalls`, but per-call privacy flags are not introspectable
   through the extensive-calls metadata we fetch. Documented as a known fidelity delta;
   the org credential may return private calls that the policy layer cannot identify.

4. **Per-workspace profile conflicts — CONFIRMED REAL.** Jen Igartua (Executive in
   Customers + Standard Team Member in People Ops), Josh Kasim (Delivery Manager+ +
   Standard Team Member), Heather Mehta, Drake Senter, Troy Conquer, Kyle Lacy all hold
   different profiles per workspace. The resolver therefore builds a *per-workspace*
   policy. Queries scoped to a workspace use that workspace's policy; unscoped call
   queries filter each call by its own workspace; unscoped stats queries use the
   union only when the per-workspace policies agree, otherwise the intersection
   (fail-closed) with a note to pass `workspaceId`.

5. **Users in no profile** — confirmed: profile membership does not cover all 180
   users (e.g. People Ops-only staff hold no Customers profile; several inactive users
   hold none anywhere). Resolution failure → fail-closed degradation to the Phase 2
   member policy (own calls/stats only), logged as `[policy] DEGRADED`.

6. **Integration User oddity** — `callsAccess.permissionLevel: "none"` with 34
   `teamLeadIds`. The level is authoritative; the lead list is vestigial UI state from
   a previous level selection. The resolver ignores `teamLeadIds` whenever the level is
   `none` or `all`.

7. **Cache TTL** — 1h org-wide snapshot TTL (~14 API calls per refresh: 2 profile
   listings + 13 profile-user lookups + 2 user pages). Stale snapshots are served for
   up to 4h if a refresh fails (logged); beyond that, resolution fails → sessions
   degrade fail-closed. Profile edits propagate in ≤1h — pending RevOps sign-off.

## Personas for unit tests and the 3e A/B

| Persona | User | Customers profile | People Ops profile |
|---|---|---|---|
| Executive (org-wide) | Jen Igartua `2830045931589947630` | Executive | Standard Team Member |
| Delivery Manager+ | Josh Kasim `628938138411517824` | Delivery Manager+ | Standard Team Member |
| Delivery Team Member | Caio Pereira `60390778292225908` | Delivery Team Member | — |
| Collaborator (contractor) | Garrett Hunt `6763988578246665360` | Collaborator | — |
| No profile anywhere | (synthetic in tests) | — | — |
