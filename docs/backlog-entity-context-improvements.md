# Backlog — `gong_entity_context` improvements (native-AI parity)

**Source:** live A/B test on 2026-06-25 comparing the paid native Gong `ask-entity` against our
credit-free `gong_entity_context`, on the **Aptitude account** (`001QQ00001u1fLMYAY`) and a **GoNimbly
umbrella opportunity** (`006QQ00000w6ZUkYAM`), same question ("open risks + agreed next steps").
~2 Gong AI credits spent (one account, one deal). Goal of this doc: capture the gaps so we can
"fight to get all this sorted." Companion to [docs/local-ai-mimic-design.md](local-ai-mimic-design.md).

**Tracking:** GitHub issues [#22](https://github.com/gonimbly/gong-mcp/issues/22) (local index, BL-2/3),
[#23](https://github.com/gonimbly/gong-mcp/issues/23) (email, BL-1),
[#24](https://github.com/gonimbly/gong-mcp/issues/24) (citations, BL-4),
[#25](https://github.com/gonimbly/gong-mcp/issues/25) (resolver, BL-5),
[#26](https://github.com/gonimbly/gong-mcp/issues/26) (maxPages, BL-6) — all on project board **GN Gong MCP (#9)**.

## What we measured

| | Native `ask-entity` (paid) | Our `gong_entity_context` (free) |
|---|---|---|
| Account — sources searched | **10 calls + 59 emails** | **1 call**, 0 emails |
| Deal — sources searched | **34 calls + 500 emails** | 10 of 13 calls, 0 emails |
| Latency | 12–15 s | 29–37 s |
| Output | structured answer + per-finding **call/email citations** | raw call digests → client model synthesizes |
| Coverage model | server-side, full time period | client-side scan, **recency-bounded** |

The native AI surfaced risks/next-steps we *structurally could not see* — all from emails (the Nooks
migration options thread, "Nico to prepare pricing", the Apollo-migration 8K-SOW risk, a procurement
3-month-overlap risk). On the calls we *did* cover, our digest quality and synthesis were on par — the
gap is **coverage**, not reasoning. (Linkage validated: both tools matched the same opportunity scope.)

---

## Backlog items

### BL-1 — Email coverage (the #1 gap) — **BLOCKED by public API** · [#23](https://github.com/gonimbly/gong-mcp/issues/23)
**Problem.** Native `ask-entity` synthesizes over **emails** (59 / 500 in the test); ours is calls-only.
**Root cause.** Gong's public REST API does **not** expose email subjects or bodies. The only email data
path is `GET /v2/data-privacy/data-for-email-address` — a GDPR/data-subject endpoint that returns
**metadata only** (`from`, `sentTime`, `mailbox`, message-id, hash; **no subject, no body**), per single
external email, in huge payloads (**243 emails / 100 KB** for one contact). Email *content* lives only
behind the paid `ask-entity`/Gong's internal index.
**Options (need a decision):**
1. **Direct email-source integration** (Gmail / Outlook via the user's own connectors) — gives real
   content, no Gong credits, but is a new integration + auth surface. *Most promising long-term.*
2. **Selective paid `ask-entity`** for email-heavy entities — accurate but spends credits (defeats the
   purpose of PR #20). Could be an opt-in "deep mode".
3. **Activity-signal only** via `data-for-email` metadata — surface "N emails exchanged, last on
   <date>, with <people>" as context. Weak (no content), heavy (100 KB/contact), and routinely hitting
   a GDPR endpoint is a semantic/policy concern. *Not recommended.*
4. **Push Gong** to expose a free email-search/content endpoint (or a credit-free entity-activity API).
**Recommendation:** pursue (1) as the real fix; document (2) as an optional deep-mode; avoid (3).

### BL-2 — Recency-bounded coverage / scan truncation · [#22](https://github.com/gonimbly/gong-mcp/issues/22)
**Problem.** On a busy org (1,400–1,700 calls/30 days) the client-side scan misses older calls —
found **1** Aptitude call where native found **10**. The `coverage.note` now flags it (PR #21), but the
data is still incomplete.
**Root cause.** Gong has **no server-side "calls for this CRM entity" filter**, so we page recent calls
and filter client-side; the page budget (`maxPages`, default 8) bounds how far back we reach.
**Options:** raise default `maxPages` (slower); a **local index/cache of call → CRM-ref mappings** so
entity lookups are instant and complete (architecture); or batch the scan smarter (date-windowed).
**Recommendation:** local CRM-ref index is the real fix; ties to BL-3.

### BL-3 — Latency (20–50 s per call) · [#22](https://github.com/gonimbly/gong-mcp/issues/22)
**Problem.** Live scans took 29–37 s (and native was 2–3× faster *and* more complete). Risks MCP-client
tool timeouts (Claude Desktop ~30–60 s).
**Root cause.** Same as BL-2 — client-side scanning of full extensive pages.
**Options:** local index/cache (pre-built call→CRM map); lower default `maxPages` for snappier-but-
shallower default; background pre-indexing of recent calls.

### BL-4 — Output citations · [#24](https://github.com/gonimbly/gong-mcp/issues/24)
**Problem.** Native returns per-finding citations (which call/email each risk came from) + counts
(`numOfCallsSearched`/`Emails`). Ours returns raw digests; the client model must attribute itself.
**Option:** add a lightweight citation/provenance structure to the returned context (call id + title
per digest is already present — could formalize an answer-with-citations shape).

### BL-5 — CRM Contact/Lead-ID → email resolver · [#25](https://github.com/gonimbly/gong-mcp/issues/25)
Today CONTACT/LEAD require the **email** as `entityRef` (calls carry no Contact/Lead `crmRefs`). A small
CRM lookup (Gong `/v2/crm/entities` or Salesforce) would let all four entity types accept a Salesforce
id uniformly. Low priority.

### BL-6 — Default `maxPages` tuning · [#26](https://github.com/gonimbly/gong-mcp/issues/26)
`maxPages` is now exposed (PR #21, default 8). Decide whether the entity-context default should be lower
(faster, shallower) given the latency in BL-3. Judgment call; the coverage note makes either safe.

---

## Architecture theme

BL-2/BL-3 share one root cause: **Gong exposes no credit-free "activity for this CRM entity" API**, so
we reverse-engineer it by scanning. The durable fix is an **indexing/caching layer** (calls + CRM refs,
and ideally emails from a direct source) that we own — turning 30–50 s recency-bounded scans into
instant, complete lookups. That, plus BL-1's email integration, is what closes the gap to native AI.

> **For PR #21:** none of these are addressed in code here — the PR ships the credit-free call-context
> tool with honest coverage notes. These items are the roadmap to native-AI parity.
