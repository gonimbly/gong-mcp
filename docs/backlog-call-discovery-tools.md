# Backlog — Call-discovery composite tools (handoff)

**Goal:** make "show me my calls", "calls Nikki was on last month", and "calls with
client Acme" one-tool-call questions. Today Claude struggles with these — it has to
orchestrate multi-page scans and client-side filtering itself, and usually gives up
early or burns a lot of tokens.

**Status:** implemented in PR #6 (2026-06-12) — `gong_find_calls`, `gong_my_calls`,
`gong_find_user`, `gong_call_summary` in `src/tools/discovery.ts` on the engine in
`src/gong/discovery.ts`. Live verification findings below.

**Branch context:** specced on `iulyanvicari/phase3-access-control-plan`
(2026-06-11). Assumes Phase 3 has merged: tools receive a policy-enforcing client,
so anything built on `getExtensiveCalls` inherits per-user visibility filtering
for free.

---

## Why this is an MCP problem, not a Gong-API problem

The public Gong API has **no search endpoint and no participant filter**:

- `/v2/calls` and `/v2/calls/extensive` filter by date range, workspace, and
  `callIds` only (verify whether `primaryUserIds` is accepted in the extensive
  filter — Gong docs suggest yes for the *primary rep*, but it does NOT cover
  non-primary participants).
- Finding "calls with person X" therefore means: page `/v2/calls/extensive` with
  `parties` exposed → match X against each call's parties → repeat per page.
- Finding "calls with account Y" needs the extensive `contentSelector.context`
  ("Extended") which attaches CRM account/deal objects per call — **verify the
  exact selector shape and response fields against the live API before building**
  (see "Live API quirks" below for how previous assumptions went wrong).

The fix is to move that scan-and-filter loop server-side into composite tools.

## Current state — where things live

- `src/gong/client.ts` — raw API wrapper (`getExtensiveCalls`, `listUsers`, …).
- `src/tools/calls.ts`, `src/tools/users.ts` — tool registration. Pattern:
  `server.tool(name, description, zodShape, handler)`; handlers call the injected
  `client` and return `JSON.stringify(data)`. **Register new tools on the injected
  client** (never `new GongClient()`) — that's what makes the policy layer apply.
- `src/server.ts` `buildServer()` — injects the per-session client
  (`ScopedGongClient` | `PolicyGongClient` | shadow wrapper, per `GONG_POLICY_MODE`).
- `src/gong/policyClient.ts` — Phase 3 enforcement. Its `getExtensiveCalls`
  override forces `parties: true` and filters calls by the user's visible set;
  composite tools built on it are policy-safe by construction.
- `tests/manual/policy-smoke.ts` — live manual test; contains a working
  cursor-pagination helper (`allPages`, 100/page, `records.totalRecords`,
  `records.cursor`) worth lifting into the implementation.
- `src/gong/__fixtures__/` — real org snapshot (profiles, profile→users, manager
  graph) used by unit tests; reuse for the new tools' tests.

## Tools to build (in value order)

### 1. `gong_find_calls` — the headline tool

> Find calls by participant, account/client, and/or title text within a date range.

Params (zod):
- `participant?: string` — email or (partial, case-insensitive) name. Resolve
  names → userIds via the directory first (see `gong_find_user` below; share the
  lookup helper).
- `account?: string` — client name or domain fragment, matched against the
  call's CRM context (and as fallback against call titles + external party email
  domains, which works even when CRM context is absent).
- `titleContains?: string`
- `fromDateTime` / `toDateTime` — default the last 30 days; require at least one
  narrowing param so the tool can't become an unbounded org scan.
- `workspaceId?`, `maxPages?` (default ~5, cap 10).

Implementation sketch:
1. Page `client.getExtensiveCalls` with `exposedFields: { parties: true }`
   (+ CRM context selector once verified) using the cursor loop.
2. Filter pages server-side: participant match = party `userId` ∈ resolved ids
   OR party email/name fragment match (mirror `hasInPolicyParty` semantics in
   `tests/manual/policy-smoke.ts` — match by email too, not just userId).
3. Return **compact summaries**, not raw API JSON: `{ id, title, started,
   durationSec, direction, participants: [name/email], account? }` plus
   `{ scannedCalls, matchedCalls, pagesScanned, truncated }` so the model knows
   whether coverage was complete. Token discipline is the point of this tool —
   raw extensive responses are huge.

### 2. `gong_my_calls`

> List the connected user's own calls in a date range.

Sugar over the same scan with `participant = session identity`. The session
identity is available in `buildServer(identity, …)` — thread it into the
register function (today only `gong_whoami` uses it). In `profiles` mode the
policy client already guarantees the user can see their own calls (self is always
in the visible set).

### 3. `gong_find_user`

> Resolve a name or email to Gong user(s): id, email, title, active, manager.

Page `client.listUsers` once, cache like `src/gong/identity.ts` does (1h TTL
module-level cache; same pattern), and do case-insensitive substring match on
name/email. Return all matches (ambiguity is useful: "two Brians, which one?").
This is also the building block for `gong_find_calls`' participant resolution.
Note: `listUsers` is an open tool in both policy modes — directory data only.

### 4. `gong_call_summary`

> One-shot digest of a call: metadata + topics + trackers + outcome + key points,
> WITHOUT the transcript.

Exists because Claude currently pulls full transcripts (enormous) just to answer
"what was this call about". Single `getExtensiveCalls({ filter: { callIds: [id] },
contentSelector: … })` call with the content fields from the existing
`gong_get_extensive_calls` registration, flattened to compact text. Policy:
`getCall`/`getExtensiveCalls` overrides already gate per-call visibility.

## Live verification findings (probed 2026-06-12, `npm run probe:extensive-filter`)

Answers to the open questions above, verified against the live API with the
keychain OAuth credential:

1. **`filter.primaryUserIds` IS accepted and honored** — probing a rep who was
   primary on calls in range returned exactly their calls (29/29 honored).
   Deliberately NOT used by `gong_find_calls`: it only covers the *primary rep*,
   so it can't answer participant questions, and mixing a pre-filtered scan with
   a parties scan would make the coverage report dishonest. Candidate future
   fast-path for `gong_my_calls` only.
2. **`contentSelector.context: "Extended"` works** — 90/100 calls in a 14-day
   range carried CRM context shaped
   `[{ system: "Salesforce", objects: [{ objectType: "Account", objectId,
   fields: [{ name, value }] }] }]` with `Name`, `Website`, `Domain__c` among
   the fields. The CRM matching arm is therefore ENABLED in `gong_find_calls`;
   the selector is only requested when `account` is given because it triples the
   page weight (694 KB vs 195 KB parties-only).
3. **`metaData.url`** (gong.app.gong.io deep link) is present on 100/100 calls —
   compact results include it for free (open question 3: yes).
4. **Strictness:** `/v2/calls/extensive` 400s on a bare `{}` body (same as
   `/v2/users/extensive`, quirk 1 below) but ACCEPTS `{ "filter": {} }` and
   returns an unbounded scan. Party `affiliation` values: `Internal`,
   `External`, `Unknown`.
5. **Scale baseline:** 766 calls in the last 14 days; a parties-only page is
   ~195 KB of JSON. Manual paging through the model was never viable — that is
   ~50k tokens per page before any filtering.

## Live API quirks (hard-won on 2026-06-11 — don't rediscover these)

1. `/v2/users/extensive` **400s on a bare `{}` body** — `"filter": {}` must be
   present even when empty. The unit-test fakes accepted `{}` and hid the bug;
   only the live smoke test caught it. **Verify every new request shape against
   the live API** (`npm run smoke:policy` pattern, keychain OAuth or org keys).
2. Stats endpoints want `filter.fromDate`/`toDate` (date-only), while call
   endpoints want `fromDateTime`/`toDateTime` (ISO). Don't mix them up.
3. Stats endpoints **404** when none of the requested userIds have stats data —
   handle as "no data", not as an error.
4. Pagination: 100 records/page, `records.totalRecords` + `records.cursor`;
   always surface `truncated` when stopping at a page cap.
5. Party visibility matches by `userId` **or** email — replicate both, not just
   userId, anywhere parties are matched.
6. Org credential requires the regional `GONG_BASE_URL` (e.g.
   `us-32447.api.gong.io`); the keychain OAuth token works on the default.

## Testing

- **Unit**: follow `src/gong/policyClient.test.ts` — in-process `globalThis.fetch`
  fake; make the fake as strict as the live API (reject filter-less bodies, page
  at 100 with cursors). Cover: name→user resolution ambiguity, participant match
  by email only, account fallback matching, page-cap truncation flagging, and a
  policy interaction case (member persona scanning calls they can't see → matches
  only within their visible set).
- **Manual**: extend `tests/manual/` (see its README) with a small
  `find-calls-smoke.ts`, or add a section to `policy-smoke.ts`: e.g. "find calls
  Nikki Mitchell participated in last 14 days" and cross-check one result's
  parties; run for a scoped persona to confirm policy filtering composes.
- CI never touches `tests/manual/` (test glob is `src/**/*.test.ts`).

## Estimates

| Item | Est |
|---|---|
| Verify extensive-filter capabilities + CRM context selector against live API | 0.5 day |
| `gong_find_user` + shared directory cache | 0.5 day |
| `gong_find_calls` + compact output + truncation reporting | 1–1.5 days |
| `gong_my_calls` (identity threading into register fn) | 0.5 day |
| `gong_call_summary` | 0.5 day |
| Tests (unit + manual) | 1 day |

## Open questions for the implementer

1. Does the extensive filter accept `primaryUserIds`, and is it worth using as a
   server-side pre-filter when the participant is the primary rep? (Cuts pages
   scanned dramatically for "my calls".)
2. Exact `contentSelector.context` shape for CRM account objects, and whether the
   org's CRM linkage is populated enough to rely on (fallback: title + external
   party email-domain matching).
3. Should `gong_find_calls` results include a `gong.app.gong.io` deep link per
   call? (The UI URL pattern is stable and users love clickable results.)
4. Tool-description wording matters for adoption: the descriptions should steer
   Claude *away* from `gong_get_extensive_calls`+manual filtering and toward
   these tools for people/client questions.
