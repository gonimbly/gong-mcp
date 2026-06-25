# Design: credit-free local equivalents for Gong's AI entity tools

**Status:** ✅ Implemented as the `gong_entity_context` tool (this PR). Part 1 (disabling the paid
endpoints) shipped in #20. The design below is what was built; the unified-tool shape, full-window
behavior, all-four-entity-types coverage, and CONTACT/LEAD participant-email linkage all landed as
described — see `src/gong/entityContext.ts`, `src/tools/entityContext.ts`, and the
`findCallsByCrmObject` / `summarizeCalls` additions in `src/gong/discovery.ts`.
**Author note:** companion to the change that disabled `gong_ask_account` / `gong_ask_deal` /
`gong_generate_brief` (see README "disabled by default" and `src/utils/featureFlags.ts`).

## Why

Gong's `/v2/entities/ask-entity` and `/v2/entities/get-brief` consume **paid Gong AI credits**, so we
disabled the three tools that call them. But their *value* — "answer a question about this
account/deal" and "give me a structured brief" — is something users still want. This design
reconstructs that value **without any paid endpoint**, using only data we already fetch for free.

Competitive note: Gong's own official MCP meters these as credits. A free, equal-or-better local
version is a differentiator for our server (see memory: `gong-official-mcp-competitive`).

## Key insight — the server doesn't need to "do AI"

This MCP server is a **pure passthrough**: every tool returns JSON and the **client's model**
(Claude) does the reasoning. We never call an LLM server-side. So "ask a question about an account"
does **not** require us to synthesize an answer — it requires us to hand Claude the *right call
context*, and Claude answers. That is exactly what `gong_call_summary` already does for one call.

So "mimicking ask/brief" = **aggregate the entity's recent calls into one compact context block**.
No new infrastructure, no model calls, no credits.

## Free building blocks (already in the repo)

| Capability | Source | Returns |
|---|---|---|
| Find calls linked to an account/deal | `findCalls()` — `src/gong/discovery.ts:551`; tool `gong_find_calls` — `src/tools/discovery.ts:16` | compact calls + `crmRefs` (Salesforce Account/Opportunity IDs) + coverage report |
| One-call digest | `summarizeCall()` — `src/gong/discovery.ts:662`; tool `gong_call_summary` — `src/tools/discovery.ts:105` | outcome, **brief**, key points, next steps, topics, trackers, participants |
| Enriched batch content | `GongClient.getExtensiveCalls()` — `src/gong/client.ts` (`/v2/calls/extensive`) | same fields in bulk |
| Speaker-attributed transcripts | `GongClient.getCallTranscripts()` (`/v2/calls/transcript`) | exact quotes when needed |

The per-call `brief` field inside `/v2/calls/extensive` is **pre-computed by Gong and free** — not a
credit call. That is the same raw material the paid `get-brief` synthesizes from.

## Proposed tools

One unified, credit-free tool covering all four CRM entity types, plus an optional templated brief
shape. (Decision: cover ACCOUNT/DEAL **and** CONTACT/LEAD — see Resolved decisions.)

### `gong_entity_context`
Replaces the value of `gong_ask_account`, `gong_ask_deal`, **and** `gong_generate_brief`.

- **Input:**
  - `crmEntityType` — `ACCOUNT | DEAL | CONTACT | LEAD`.
  - `entityRef` — the identifier, **semantics depend on the type**:
    - `ACCOUNT` → Salesforce Account ID (from a call's `crmRefs`).
    - `DEAL` → Salesforce Opportunity ID (from `crmRefs`).
    - `CONTACT` / `LEAD` → the **person's email** (see linkage note below).
  - `timePeriod?` — default last 30 days; **any** date range (not limited to Gong's fixed enum).
  - `workspaceId?`, `includeTranscripts?` (default false — opt in for exact quotes),
    `maxCalls?` (budget, default ~10 newest).
- **Behavior:** resolve the entity's calls, then aggregate each call's digest (`summarizeCall`
  fields — outcome, brief, key points, next steps, topics, trackers, participants) into one ordered
  context block (newest first) over the **full window**, plus a coverage report. **No `question`
  parameter** — we return the whole window and let the client model filter and answer (Decision 2:
  full window). Optional transcripts when exact quotes are needed.
- **Output:** `{ entity, period, calls: CallDigest[], coverage }` as JSON text. Claude answers any
  free-text question, or formats a brief, from this context.

### CONTACT/LEAD linkage (the one structural difference)
Calls carry `crmRefs` for **Account and Opportunity only** — not Contact or Lead. So CONTACT/LEAD
calls are linked by **exact participant email**: `findCallsByParticipantEmail` matches the person's
address against call participants (internal and external attendees) using `emailExact` equality —
*not* the substring/fragment match that the general `findCalls` participant query uses — so one
contact's context can't fold in a different attendee whose address merely contains the query (e.g.
`a@acme.com` must not pull in `xa@acme.com`). If the caller only has a CRM Contact/Lead ID,
resolving it to an email is a CRM-side lookup the follow-up can add; v1 accepts the email directly.

### Brief shape
`gong_generate_brief`'s structured multi-category output (themes / stakeholders / risks) is the same
aggregation framed for a review. Default: **reuse `gong_entity_context`** and let the client model
format the brief from a prompt (zero extra code). Add a templated `gong_entity_brief` that
pre-groups sections (stakeholders from participants, risks from trackers/key points, themes from
topics) only if users want a fixed, deterministic shape.

## Trade-offs vs the paid endpoints

| | Paid ask/brief | Local context tools |
|---|---|---|
| Cost | Gong AI credits per call | Free (standard request quota only) |
| Reasoning quality | Gong's model | Claude (Opus/Sonnet) — typically stronger |
| Latency | one Gong AI call | a few `/v2/calls/extensive` pages |
| Token cost to client | small (pre-synthesized answer) | larger (raw-ish context) — mitigate with `maxCalls`, compact digests, opt-in transcripts |
| Freshness window | Gong's `timePeriod` enum | any date range we choose |
| CRM entity types | ACCOUNT/DEAL/CONTACT/LEAD | ACCOUNT/DEAL via `crmRefs`; CONTACT/LEAD via participant-email linkage |

Main risk is **context size / token cost**. Keep digests compact (the `gong_call_summary` shape is
already ~KB-scale), cap `maxCalls`, and gate transcripts behind `includeTranscripts`.

## Implementation sketch

- New `src/tools/entityContext.ts` exporting `registerEntityContextTools(server, client, identity?)`,
  registered alongside the others in `src/index.ts` and `src/server.ts`. **Always registered** — not
  gated by `GONG_ENABLE_AI_ENTITIES` (Decision 3: complementary to the paid tools).
- Core aggregation in `src/gong/entityContext.ts` reusing `findCalls` + `summarizeCall` (no new Gong
  endpoints). Add `aggregateEntityContext(client, { crmEntityType, entityRef, period, maxCalls })`
  that branches the call-resolution: `crmRefs` match for ACCOUNT/DEAL, `findCallsByParticipantEmail`
  email match for CONTACT/LEAD.
- Unit tests with mocked `findCalls`/`summarizeCall` (cover all four types + the email-linkage
  branch); a manual probe under `tests/manual/`.
- Wire the Part 1 disabled-tool message to point users here once these exist.

## Resolved decisions

1. **Cover all four CRM entity types** (ACCOUNT, DEAL, CONTACT, LEAD). CONTACT/LEAD have no `crmRefs`
   on calls, so they link by **exact participant email** via `findCallsByParticipantEmail` (v1 takes the
   email directly; CRM-ID→email resolution is a later add).
2. **Full window, no `question` param** — return the whole time-window aggregation and let the
   client model filter and answer. Simpler, more transparent, and more general than the paid tool.
3. **Always available, ungated** — the local `gong_entity_context` tool is registered regardless of
   `GONG_ENABLE_AI_ENTITIES`; it complements (does not replace) the paid tools when those are on.
