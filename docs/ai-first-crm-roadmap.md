# Gong → Salesforce: The Self-Updating CRM Roadmap

## Thesis

Gong holds the richest record of what actually happened in every revenue conversation; Salesforce is where that truth is supposed to live but rarely does. The 2026 market has converged on one idea — **the CRM should update itself** — shifting from CRM-as-system-of-record (humans serve the database) to CRM-as-system-of-action (agents observe a call, then log activity, update fields, fill qualification frameworks, set contact roles, and flag deal risk). Our wedge is the one no incumbent occupies: a **permission-gated, Salesforce-native, conversation-to-CRM *write* bridge** running on the customer's **own self-hosted Gong MCP**, under their **own native Gong permission profiles**, with data that never leaves their stack. Gong's own June-2026 MCP is read-only and withholds raw transcripts; Clari+Salesloft's is execution/Cadence-centric with thin write governance; Salesforce's GA hosted MCP governs Salesforce writes but knows nothing of Gong call visibility. We sit in the seam.

This roadmap is **staged and layered**: **Foundation** (make the read surface complete and stand up a safe, gated Salesforce write spine) → **Automation** (extract structured signal from calls and propose governed writes, triggered after each call) → **Agentic** (compose it all into an ambient, supervised-then-autonomous deal desk). Most EPICs are shippable on **today's** Gong + Salesforce APIs; a few are explicit north-stars gated on betas and net-new infra. We are honest below about what is built, what is greenfield, and what the feasibility pass corrected.

---

## Roadmap at a glance

### Foundation

| EPIC | Layer | Horizon | Effort | Feasibility | One-liner |
|---|---|---|---|---|---|
| Salesforce Write Spine (`gong_sf_*`) | Foundation | Near-term | L (descope to ship) | High | A first-class `src/sf/` Salesforce client behind a scoped wrapper that routes every write through the same fail-closed gate; idempotent `gong_sf_*` tools. |
| Governed Write Spine | Foundation | Near-term | L (split to ship) | Medium | Risk-tiered policy engine + dry-run preview + provenance ledger + human-in-the-loop over every write. |
| Call Media & Spotlight Export Suite | Foundation | Near-term | S–M | Medium | Surface Gong media URLs, Spotlight briefs, key moments, and structured outcomes as gated tools. |
| AI Ask-Anything, Unleashed | Foundation | Near-term | S→M | Medium | Add contact asks and a call→CRM-anchor→gated-ask path on top of our thin `ask_account`/`ask_deal`. |
| Deal Review Cockpit | Foundation | Near-term | M | Medium | One-call, evidence-cited deal & account reviews with re-derived, quote-linked risk. |

### Automation

| EPIC | Layer | Horizon | Effort | Feasibility | One-liner |
|---|---|---|---|---|---|
| Activity & Buying-Committee Auto-Capture | Automation | Near-term | M (full = L) | Medium | Auto-log calls as Salesforce activities and propose Opportunity Contact Roles from participants. |
| MEDDIC/MEDDPICC Autopilot | Automation | Near-term | L | Medium | Extract qualification fields + next steps from transcripts, review-mode write-back, no field cap. |
| CRM Hygiene Agent | Automation | Near-term | M (full = L/XL) | Medium | Detect stale/contradictory Salesforce fields against call truth; propose evidence-backed repairs. |
| Coaching-at-Scale Console | Automation | Near-term | M | **High** | Manager-facing conversational coaching across the visible reporting tree, evidence-linked. |
| Pipeline & Forecast Inspector | Automation | Near-term (Slice 1) | L–XL staged | Medium | Conversational, signal-based pipeline/forecast inspection with week-over-week movement. |
| Smart Trackers & Scorecards Signal Layer | Automation | Near-term | M | **High** | Turn tracker hits and scorecard answers into per-call, write-ready signals. |
| Post-Call Trigger Runtime | Automation | Near-term (Slices 1–2) | M→L | Medium | Gong webhook + scheduler to run extract→propose→gated-write automatically. |
| Deal Intelligence & Forecasting Signal Feed | Automation | Near-term (Phase 1) | L staged | Medium | Re-derive Gong's 8 deal-risk warnings as a shared, evidence-linked library. |

### Agentic

| EPIC | Layer | Horizon | Effort | Feasibility | One-liner |
|---|---|---|---|---|---|
| Self-Driving Deal Desk | Agentic | North-star | XL | **Blocked** (sequence last) | The capstone post-call + nightly loop that proposes/commits gated Salesforce writes. |
| Agentforce / A2A Citizen | Agentic | North-star | L (read-slice = S/M) | Medium | Make our governed write bridge a discoverable, governed action source inside Agentforce/A2A. |

---

## The EPICs, in full

---

### EPIC: Salesforce Write Spine — direct, gated, idempotent write-back client (`gong_sf_*`)

`layer: foundation` · `horizon: near-term` · `effort: L (descope V1)` · `feasibility: HIGH`

**Problem / opportunity**
Verified: there is **zero Salesforce-native write-back** today. The only CRM write path is Gong's generic `/v2/crm/entities` upsert, which `src/tools/crm.ts` notes returns nothing for native-Salesforce-connector orgs and writes a Gong *shadow* CRM — not Salesforce. Dormant client methods (`uploadCallMedia`, `upsertCrmEntities`, `createTask`, `logDigitalInteraction`) are **not registered as MCP tools** and none reach Salesforce. The enforcement spine the EPIC wants to reuse is real and tested: `requireCapability` is generic over `keyof capabilities`, owner-only-private gating and `visibleCallIds()/isVisibleCall()` exist. But the model literally cannot write a Task or a field on a real Salesforce Opportunity.

> **Feasibility correction (must absorb before sizing):** the EPIC claimed an agent can *already* "resolve a call to its SF Account/Opportunity ID." It **cannot** today — `discovery.ts` surfaces only the CRM Account *display name*; the `objectId` is parsed for matching then dropped, and `entities.ts` takes `crmAccountId/crmDealId` as **inputs**, never as resolved outputs. Surfacing the SF `objectId` in discovery output is **cheap but real net-new scope** (the data is already in the extensive response) and is a **prerequisite** for this EPIC.

**Why it matters (value)**
Closes the biggest Foundation→Automation blocker and the core GoNimbly differentiator: targeted, permission-gated writes into the customer's **own** Salesforce on their **own** self-hosted MCP — data never leaves their stack (unlike Weflow/Oliv/Momentum SaaS). Unlocks every downstream write EPIC. Sellable immediately as a Gong-to-Salesforce accelerator.

**AI-first angle**
Turns the MCP from a read surface into a **system of action**: an agent that resolves a call to its SF Account/Opportunity ID can now *act* on that record, committing idempotently so "log this call" twice never duplicates.

**Proposed features** (descoped to a shippable V1 + explicit deferrals)
- [ ] **(Do first — prerequisite)** Surface the SF `objectId` for Account *and* Opportunity in discovery output so the agent can find the target record.
- [ ] `src/sf/salesforceClient.ts` with OAuth 2.0 JWT Bearer (run-as-rep via `sub=username`); org cert/key in server env, mirroring the Gong pattern.
- [ ] `SalesforceScopedClient` mirroring `PolicyGongClient`: every write routed through `requireCapability` **plus** a visible-call check reusing `visibleCallIds()/isVisibleCall`; owner-only-private extended verbatim to writes.
- [ ] **One write tool first:** `gong_sf_log_call_activity` (Task/Activity linked to the call's SF Account/Opp via `WhatId`) — proves the whole spine end-to-end on one object.
- [ ] **Mandatory dry-run/preview as the DEFAULT** — before/after diff + resolved record IDs, no commit. This is the HITL safety valve, not optional.
- [ ] Idempotent upsert-by-external-ID keyed on **call-id + activity-type** (not call-id alone — one call legitimately yields multiple distinct activities).
- [ ] New field-level write capabilities (`sfLogActivity`/`sfCreateTask`/`sfUpdateFields`/`sfContactRoles`) — `requireCapability` is already generic, so only the vocabulary + resolver mapping change.
- [ ] **(Defer to follow-on)** `gong_sf_update_opportunity_fields`, `gong_sf_set_contact_roles` (validation-rule/dependent-picklist hell — pair with the Governed Write Spine), and Composite/`allOrNone` bundling (only needed once multi-write tools exist).

**Gong dependencies**
Existing only: call-to-CRM-account linkage in `discovery.ts`, `requireCapability` + `visibleCallIds/isVisibleCall`, participant speaker-ID-to-name resolution (PR #12), org-credential-in-env. **No new Gong endpoints.** Note: `/v2/calls/extensive` context *does* return Salesforce `objectType/objectId/fields` — the data exists, it's just not surfaced today.

**Salesforce dependencies**
Salesforce REST; OAuth 2.0 JWT Bearer via External/Connected App; upsert-by-external-ID (custom External-ID field **per object per org**); Composite API (25-subrequest hard limit, `allOrNone`, cumulative governor limits); Task/Event (`WhoId`/`WhatId`), Opportunity, OpportunityContactRole. **JWT Bearer prerequisites (call out):** the target rep must have logged into Salesforce at least once **and** be admin-pre-authorized via the Connected/External App + profile/permset; a rep with no SF user, or never-logged-in, **cannot** be impersonated — fail-closed must cover this.

**Permission & safety**
Double-gated, fail-closed: **first** our Gong capability gate (new `sf*` caps) + the visible-call check (a write is allowed only when the user could *see* the justifying call); **second** Salesforce FLS/sharing/validation as the run-as rep. Three risks to gate explicitly: **(a)** run-as fallback **must be fail-closed-deny**, never run-as-admin, when the rep can't be impersonated; **(b)** the email→SF-username map must be **explicit, admin-curated, verified** (never fuzzy-matched) — the Google-verified email is the only trusted identity; **(c)** the visible-call gate must run on the *justifying* call's id, and the SF target must be the record actually linked to that call in Gong context, or a user could write to a record they have no Gong basis to touch. Every write lands in the single audit plane.

**Risks / open questions**
- **Identity-mapping bridge is the gating risk, not the code.** Run a small spike with the customer's SF admin *before* committing to the L: if usernames aren't email-format or reps lack SF users, run-as degrades to a single integration user (forfeiting the per-rep FLS value prop) and our differentiation weakens.
- Custom External-ID field provisioned per object per org (customer metadata deploy).
- Connected/External App + cert is **customer-provisioned per-deployment onboarding**, not code.

---

### EPIC: Governed Write Spine — risk-tiered policy engine + provenance ledger + HITL over every write

`layer: foundation` · `horizon: near-term` · `effort: L (split to ship; HIGH once descoped)` · `feasibility: MEDIUM`

**Problem / opportunity**
Verified: the policy layer enforces only the binary "is this user allowed?" via `requireCapability`. No dry-run/preview, no human confirmation, no per-write change record, no idempotency receipt, no rollback. `gong_get_audit_logs` reads Gong's **own** org log; it records nothing about what *our* agent writes. Writing into Salesforce on that footing is unsellable to RevOps and exposed under EU AI Act high-risk logging (Aug 2026). It's the same governance gap the market flags in Gong's AI Data Extractor (silent overwrite, no review) and Agentforce's multi-agent seam.

> **Feasibility reality:** the load-bearing gap the EPIC understates is that **there is no Salesforce client and no persistent datastore in the repo today** (deps are only `@modelcontextprotocol/sdk`, express, zod, keyring). This spine is the *governance half* of the safety model and **has nothing to govern until SF writes exist** — so the Salesforce Write Spine must land first. Re-rates to **HIGH** once descoped as below.

**Why it matters (value)**
Governance-as-differentiator and the thing GoNimbly sells. Turns "we can write to Salesforce" into "we write safely, reversibly, provably." Beats Gong's Extractor on its weak points (review-mode, no field cap, change-diffing), is the prerequisite every write EPIC depends on, and de-risks the whole roadmap by building early. Doubles as EU-AI-Act / SOC 2 evidence.

**AI-first angle**
Implements the canonical 2026 agentic-guardrail pattern as reusable infra: per-action risk tier, confidence threshold, and the named HITL patterns (pre-execution gate, exception escalation, graduated autonomy, sampled audit, output review) with the notify/question/review trichotomy. High-confidence low-risk auto-commits; low-confidence/high-stakes route to a human.

**Proposed features** (ship the real spine now; defer the speculative parts)
- [ ] **Versioned (YAML) risk-tier policy engine** — maps each write tool/field to low/medium/high (log-activity auto, set-contact-role notify, update Amount/Close Date approval-gate). Per-org overridable. Validates required fields/dependent picklists/record-type rules via describe-object before commit. *Defaults unknown/high to approval-gate.*
- [ ] **Dry-run/preview + write-receipt** — before/after diff + resolved record IDs without committing; committed write returns a receipt with SF record IDs. **Never silently overwrite a non-empty value.** (Mostly pure logic over describe-object; no new datastore.)
- [ ] **Append-only, tamper-evident provenance ledger + policy snapshot** — per write: `decision_id` + lineage, model version + sampling, reasoning trace + confidence, tool name/version/args/result, data freshness, before/after state, Gong evidence cited, approver, **and which capability gate + risk-tier policy version authorized it.** Denied actions logged too. *Pick one durable store now (Postgres/Redis).*
- [ ] **One approval path for v1: durable out-of-band queue** reusing the existing Slack webhook (`utils/alert.ts`) as the notify channel — Slack approve/deny links. **Do not build the agent-inbox UI yet.**
- [ ] **(Defer)** One-click compensating rollback — scope v1 to **additive/no-side-effect writes only** (create task, log activity, fill an *empty* field); **explicitly refuse to advertise rollback for Amount/Close-Date/anything that fires flows** (SF side-effects aren't reversible).
- [ ] **(Defer)** Graduated autonomy + confidence escalation — needs per-customer action-error data that won't exist until the spine has run in prod for months.

**Gong dependencies**
Reuses `requireCapability`, `visibleCallIds/isVisibleCall` (attach the justifying call to each ledger entry), the logs module as the audit seed, `quota.ts` pacing, and the Slack alert plumbing as one notify channel. **No new Gong endpoints.**

**Salesforce dependencies**
describe-object (validation/required/picklist deps for pre-commit validation); upsert-by-external-ID + Composite receipts; record snapshot via REST GET for undo handles. Ledger lives our side.

**Permission & safety**
Composes **on top of** `requireCapability`: the capability gate answers "may this user write at all?"; the policy engine answers "does this write need a human first?". Fail-closed — if policy can't be evaluated, the write is **queued, never auto-committed**. **Design requirement:** the ledger and approval inbox inherit the **same visibility constraints** as the calls/CRM they record — a ledger entry citing a private call stays owner-only; an approval inbox must not leak a manager's deal-field diff to a rep outside visibility. Otherwise the ledger becomes a side-channel that re-leaks what `isVisibleCall` carefully gates.

**Risks / open questions**
- MCP elicitation has uneven 2026 client support and is one-way streaming → the durable out-of-band queue is **mandatory**, and this is the **first persistent state** this near-stateless server holds (provision a real store with backup/retention; EU AI Act Art. 12 mandates ≥6-month logs).
- Rollback is only as good as captured prior state; SF triggers/flows firing on our write aren't cleanly reversible.
- Confidence thresholds / graduated-autonomy criteria need real action-error data that doesn't exist yet.

---

### EPIC: Call Media & Spotlight Export Suite

`layer: foundation` · `horizon: near-term` · `effort: S–M (drop M→S by cutting upload)` · `feasibility: MEDIUM (HIGH once descoped)`

**Problem / opportunity**
Verified: our 52 tools expose transcripts but **not** the rich media/AI-synthesis layers Gong produces. `getExtensiveCalls` can request brief/highlights/outline/outcome but **no tool returns playable media**, and the resolved `downloadCallMedia` capability gates nothing. A Salesforce-first product that wants to attach a recording or Spotlight brief to an Opportunity can't, because there's no media/Spotlight tool. (The `media` value already in our digests is the metadata type-enum string "Video"/"Audio" — **not** a URL — so the gap is real.)

**Why it matters (value)**
Unlocks the richest untapped Gong asset (media + AI Spotlight) for downstream Salesforce activity logs, exec briefings, handover docs. A Spotlight brief or recording deep-link on a Task/Opportunity is immediately sellable and makes our MCP **strictly richer than Gong's read-only June-2026 MCP** (which withholds raw transcripts *and* media).

**AI-first angle**
Gives the agent actual call artifacts (audio deep-link, Spotlight brief, key moments) to cite as **evidence** when it proposes a Salesforce write — turning opaque call IDs into reviewable, linkable evidence the approver verifies before commit.

**Proposed features** (ship 3 reads, **cut the upload**)
- [ ] `gong_get_spotlight_brief` — compose already-plumbed `getExtensiveCalls` brief/outline/keyPoints selectors into a compact digest. **(Ship first — near-zero risk, no new scope.)**
- [ ] `gong_get_call_highlights` — curated highlight moments + structured call outcome (`includeHighlights`/`includeOutcome` already wired) so the agent can quote the moment that justifies a field change.
- [ ] `gong_get_call_media` — return Gong's temporary ~8h S3 media URL(s) via `exposedFields.media=true`, gated on `downloadCallMedia` (its first real consumer). **Runtime scope check:** first verify the org key holds `api:calls:read:media-url`; if absent, return a clear "media scope not provisioned" message, not a raw Gong 403. Stamp expiry, **never cache**, and return the **stable `metaData.url` deep-link** alongside the rotting signed URL.
- [ ] ~~`gong_upload_call_media`~~ **CUT from this EPIC.** The dormant `uploadCallMedia` method is almost certainly broken (it sends JSON `{mediaUrl}`; the real `PUT /v2/calls/{id}/media` needs **multipart/form-data binary** + `api:calls:create`), and ingesting external recordings is a recording-consent/compliance surface that a read-focused EPIC shouldn't carry. If wanted, it becomes its own gated-write EPIC with a multipart client path and a consent guardrail.

**Gong dependencies**
`POST /v2/calls/extensive` (brief/highlights/outline/keyPoints/callOutcome selectors, already wrapped); media URLs are short-lived (~8h, `X-Amz-Expires=28800`) and require the **extra OAuth scope `api:calls:read:media-url`** on top of `read:extensive` — **live-verify on the real org key before building.** Spotlight data exists only after Gong post-processing (call ≥30s, transcript ≥100 words) — tools must tolerate "not generated yet" and never block. Correctly avoids the deprecated `/v2/calls/ai-content` endpoint.

**Salesforce dependencies**
None to read media. Downstream the Write Spine attaches the **deep-link or Spotlight text** to a Task/Opportunity. **Forbidden in the output contract:** persisting the rotting 8h signed URL on a Salesforce record — store the stable Gong deep-link + Spotlight text, or trigger an on-demand re-fetch.

**Permission & safety**
Reads pass `visibleCallIds()/isHiddenPrivate` verbatim, so private calls stay owner-only and out-of-visibility 403. Media is **more sensitive** than transcript (raw customer voice), so `downloadCallMedia` is applied **in addition to** (not instead of) the visibility filter — add a `private.test.ts` proving a non-owner *with* `downloadCallMedia=true` still cannot pull a private call's media.

**Risks / open questions**
- The single biggest unknown is whether the org credential holds the `media-url` scope — **verify live first.**
- Live-confirm `downloadCallMedia` semantics (download vs stream) against a real profile before gating.

---

### EPIC: AI Ask-Anything, Unleashed — cross-entity & evidence-cited

`layer: foundation` · `horizon: near-term` · `effort: S (Slice 1) → M (Slice 2)` · `feasibility: MEDIUM`

**Problem / opportunity**
We wrap `askAccount`/`askDeal`/`generateBrief` but underuse them. Every ask requires a **pre-known** `crmAccountId/crmDealId`; there's no path from "a call I found via `gong_find_calls`" to "ask about its account/deal." Windows are locked to four fixed enums; `requireAllCalls` blocks restricted reps.

> **Feasibility corrections:** (1) **`gong_ask_about_call` is the real work, and it's M, not S** — `discovery.ts` only reads `objectType==='Account'` and surfaces the account *name*; it never reads Opportunity and never extracts `objectId`. Resolving a call to a verified CRM anchor is **net-new extraction code** (read `objectId` for Account + Opportunity, disambiguate 0/1/many opportunities), not "just dispatch." (2) **LEAD-ask probably doesn't exist** — Gong's own MCP supports CONTACT for `generate_brief` but `ask` is ACCOUNT/DEAL only and mentions no LEAD; CONTACT-ask is plausible, LEAD-ask is likely a 404. **Live-verify both; design for "LEAD unsupported."**

**Why it matters (value)**
Turns three narrow tools into a genuine "ask anything about this relationship" primitive — the canonical AI-first-CRM capability — and grounds Salesforce field proposals by going **call → verified CRM anchor → gated ask**.

**AI-first angle**
This *is* the Ask-Anything brain: an agent chains `gong_find_calls`, resolves the call's Account/Opportunity, asks Gong entity AI a structured question, then hands the answer to a gated Salesforce field-update proposal — collapsing a manual multi-hop into one grounded primitive.

**Proposed features**
- [ ] **(Slice 1, true S — ship first)** `gong_ask_contact` (CONTACT corroborated by Gong's own MCP `generate_brief`). Add a **gated `askContact` client method with `requireAllCalls` (policy) and `requireAdmin` (scoped) overrides in BOTH subclasses** — *not* by passing `crmEntityType` through from the tool layer, which bypasses the gate entirely.
- [ ] **(Slice 1)** Window-fit guidance — return the four supported `timePeriod` windows + actual call-coverage per window so the model picks `THIS_QUARTER` vs `THIS_MONTH` deliberately.
- [ ] ~~`gong_ask_lead`~~ **Hold** until `ask-entity` LEAD support is live-verified; evidence says it probably doesn't exist — don't ship a tool that always 404s.
- [ ] **(Slice 2, size as M)** `gong_ask_about_call` — net-new CRM-context extraction (`objectId` for Account + Opportunity surfaced on the call digest), call resolution through the **policy-filtered `summarizeCall` path** (invisible call → empty → not-found, fail-closed), opportunity disambiguation, then route into the gated ask method.
- [ ] **(Defer / thin)** Batched multi-entity ask — hard concurrency cap (≤2–3 in-flight under the 3 req/s budget), with an **explicit per-entity allowed/denied result shape** so partial-permission cases are honest.

**Gong dependencies**
`GET /v2/entities/ask-entity` (fixed `timePeriod` enum verified live), `GET /v2/entities/get-brief`. CONTACT support for `ask-entity` inferred — **live-verify**. CRM `objectId` rides in `/v2/calls/extensive` context (`context:'Extended'`); IDs are Gong's snapshot at last sync, so "no opportunity linked" is a legitimate answer.

**Salesforce dependencies**
Reads Account/Opportunity/Contact IDs already flowing through call context. No write — this is the read/AI feeder for the write EPICs.

**Permission & safety**
The real enforcement lives in the **client subclasses** (`requireAllCalls` in policy, `requireAdmin` in scoped), and those methods are **private** — so safety requires adding gated `askContact` methods, **not** passing entity type through the tool layer. `requireAllCalls` correctly denies restricted reps (these synthesize over the whole workspace). `gong_ask_about_call` resolves the call via the already-policy-filtered path *first*, so it's fail-closed by construction.

**Risks / open questions**
- Live-verify `ask-entity` accepts CONTACT (likely) and LEAD (likely not).
- `requireAllCalls` makes these unusable to restricted reps — acceptable, but document it (no degraded single-deal ask path in v1).
- Rename the EPIC's headline to reflect the win is **"call → verified CRM anchor → gated ask"**, and stop calling that part an S.

---

### EPIC: Deal Review Cockpit — one-call, evidence-cited deal & account reviews with re-derived risk

`layer: foundation` · `horizon: near-term` · `effort: M (v1 M→S)` · `feasibility: MEDIUM`

**Problem / opportunity**
Today a deal review forces the model to chain `find_calls`, `call_summary`, `ask_deal`, `get_transcripts` across many calls — burning the 3 req/s and 10k/day budget and producing inconsistent, un-cited narratives. No single "review this deal" primitive. Gong's AI Deal Monitor warnings (8 types) and Deal Likelihood Score live only in the board UI, **not API-exposed**. This EPIC also absorbs read-side stakeholder mapping and brief generation from the former Account Research lens.

> **Two feasibility corrections the implementer must absorb:**
> 1. **`ask_deal` is not a CRM-rich deal-state oracle.** It returns conversation-derived answers, period-bounded to the four fixed windows, capped at ~60 calls/500 emails, and **ignores CRM-synced fields**. So **Stalled-in-stage / Overdue flags require a Salesforce read** (Stage/CloseDate) — they are **phase 2**, not "optional later."
> 2. **The permission claim is wrong in prod.** `requireAllCalls` is a **hard fail-closed DENY** for any non-all-access caller. Profiles mode is the prod default, so `ask_deal`/`ask_account`/`generate_brief` are usable **only by all-access/admin sessions**. The "degraded, transcript-only review" the EPIC filed under risks is in fact the **default and only path for most users** — it must be the **primary engineering deliverable**, not a fallback.

**Why it matters (value)**
Turns the most-run revenue workflow into a single deterministic call returning a manager-ready review: state, momentum, risk flags with linked call-quote evidence, stakeholder map, open next steps — every claim auditable back to a transcript line. Read-only, ships fast, builds trust before any write. Strong standalone QBR/exec-brief offering.

**AI-first angle**
The conversational front door of the revenue brain: one question returns a complete sourced answer instead of a tool-chaining slog. It re-derives Gong's deal-risk taxonomy via the shared Deal Intelligence library, adds quote-level explainability Gong withholds, and builds stakeholder maps and objection timelines from transcripts (which Gong's MCP withholds).

**Proposed features** (three slices)
- [ ] **(v1, M→S)** `gong_deal_review` composite for **all-access/admin sessions**: `ask_deal` + extensive (trackers, context) + transcripts (PR #12 citations) + stats → `{state, momentum, stakeholders[], nextSteps[], evidence ledger}`. **Defer the risk panel.**
- [ ] **(v1)** **Degraded restricted-user path as a first-class deliverable:** for non-all-access callers, **skip `ask_deal` entirely** and synthesize from policy-filtered extensive + transcripts only, noting "limited to calls you can see; AI deal-Q&A unavailable on your profile."
- [ ] **(v1.5)** Conversation-derivable risk flags only — Ghosted, Not-enough-contacts, No-power, Pricing-not-mentioned, low-activity — each **hard-labeled "GoNimbly-derived, evidence-linked — not Gong's native Deal Monitor"** with the triggering call quote. Build the Deal Intelligence heuristics as a standalone, unit-tested module first.
- [ ] **(v1.5)** Stakeholder / buying-committee map from resolved participants (PR #12) with role inference and engagement recency — the read-side precursor to the SF Contact-Role write.
- [ ] **(v2)** `gong_account_review` for QBR/exec prep + the Salesforce-read-dependent **Stalled/Overdue** stage-dwell flags.
- [ ] **(out of v1)** Evidence ledger + **export-to-draft** (draft-only, never auto-sent; inherits no broader data than the session saw).

**Gong dependencies**
`ask-entity`/`get-brief` (four fixed windows; ≤60 calls/500 emails; ignores CRM fields), `/v2/calls/extensive` (trackers + CRM linkage), `/v2/stats`, transcripts + speaker-ID resolution (PR #12). Deal-Monitor warnings **not API-exposed** → re-derive. The deal must already be CRM-synced into Gong for `ask_deal` to resolve, else it 404s, and we can't backfill that linkage.

**Salesforce dependencies**
Read-only anchor (Opportunity/Account ID) in v1/v1.5. **A real Salesforce read client is a HARD dependency for the Stalled/Overdue flags and any SF-field context** — does not exist today; cut those flags from v1.

**Permission & safety**
Leak surface is clean **by construction** — `getExtensiveCalls`/`getCallTranscripts`/`visibleCallIds` enforce `isVisibleCall` + owner-only-private on every page, so quote evidence can only cite calls the caller may see. **Re-word the EPIC's permission section before build** — it currently misstates `requireAllCalls` and will mislead the implementer. Keep export-to-draft strictly draft-only and out of v1.

**Risks / open questions**
- Re-derived flags diverge from Gong's native Deal Monitor — label "derived, evidence-linked."
- The "shared Deal Intelligence library" does **not exist yet** — net-new, unit-tested against Gong's actual tracker/party shapes (the bulk of the M effort).
- Large accounts blow the 3 req/s budget — per-session cache + page caps are **mandatory**.
- Citation accuracy depends on PR #12 staying stable.

---

### EPIC: Activity & Buying-Committee Auto-Capture — zero-manual logging + contact roles

`layer: automation` · `horizon: near-term (Slice 1)` · `effort: M (Slice 1); full = L` · `feasibility: MEDIUM`

**Problem / opportunity**
Automatic activity capture and contact-role population are table-stakes AI-first-CRM capabilities reps still do by hand. Gong's native SF sync is logging-first but dumps summaries as **unstructured notes**, not structured contact roles, and the buying committee is rarely kept current.

> **Feasibility reality:** the read side is fully available today (parties + emails + Account/Opp `objectId` from one `/v2/calls/extensive`; speaker-ID resolution from PR #12), but **there is no real-time trigger** — Gong has no per-call webhook subscription REST API, so "every relevant call" means **polling** (or the Trigger Runtime). And **Gong's own native SF integration already auto-logs activities, creates Events, and runs a flow that adds conversation participants to contact roles** — so our two headline features **overlap shipping Gong functionality.** Differentiate on **structured, diffed, gated, role-inferred** writes, not on "we log calls."

**Why it matters (value)**
The highest-frequency, lowest-controversy write (logging a call is low-risk) — the ideal trust-builder and broadest-reach feature. Current Contact Roles materially improve forecasting and the No-power/Not-enough-contacts deal-risk signals downstream.

**AI-first angle**
We resolve transcript speaker IDs to participant names; extending that to **email-match participants to Salesforce Contacts and infer role** (champion/economic buyer/influencer) from how they spoke is exactly the buying-committee auto-population the 2026 pattern prescribes — and our wedge over Gong's blunt "add participant if they're a contact."

**Proposed features** (three slices)
- [ ] **(Slice 1, real M, propose-only, no scheduler)** `gong_sf_log_call_activity(callId)` — fetch via the **scoped** client (inherits owner-only/participant gates), email-match parties to SF Contacts, write ONE completed Task (`WhoId`=primary external Contact, `WhatId`=Opp/Account), idempotent on Gong callId via external-ID upsert, returning a **diff for human commit**.
- [ ] **(Slice 2)** OpportunityContactRole in strict **propose-mode** — diff against existing roles, **never set `IsPrimary` on update** (it silently auto-unsets the prior primary), unknown participants become **approval-required hygiene suggestions** (no silent Contact creates).
- [ ] **(Slice 2)** Participant→Contact resolution by email — create-or-flag unknowns as suggestions to avoid duplicate Contacts.
- [ ] **(Slice 3, defer)** "Every relevant call" auto-commit, **coverage/blast-radius toggles** (per-rep/workspace; whether to log internal-only calls; rate caps), and **backfill** via sObject Collections upsert (max 200/call, re-runnable) — these need the scheduler, rate accounting, and a **service-account leak review** (backfill must run each call through the same per-user visibility gate, **never a privileged path**).

**Gong dependencies**
`gong_find_calls`/extensive for call + participant context, speaker-ID-to-name (PR #12), CRM-account linkage from `discovery.ts`. Optionally the Trigger Runtime to fire per-call. **No new Gong endpoints.**

**Salesforce dependencies**
Write Spine; Task/Event (`WhoId`/`WhatId`), OpportunityContactRole; Contact/Lead query-by-email; sObject Collections upsert for backfill; describe-object for role picklists.

**Permission & safety**
Gated on `sfLogActivity`/`sfContactRoles` + the visible-call check (owner-only private calls). **Leak vector to design against:** the write lands with an org-wide-visible SF credential — if the source-call visibility check is bypassed (e.g., backfill as a service account), a private/restricted call's existence/summary leaks into SF where others read it. Contact-role inference is **proposed with diff**, never silently overwriting curated roles. All idempotent + audited.

**Risks / open questions**
- The named gates (`sfLogActivity`/`sfContactRoles`) **don't exist yet** — build them; don't pretend.
- Email-only matching misses participants with no/mismatched SF Contact (dupe risk).
- Role inference is fuzzy — stay propose-mode.
- Deciding the primary `WhoId` on multi-party external calls; whether to log internal-only calls.

---

### EPIC: MEDDIC/MEDDPICC Autopilot — Salesforce-native, uncapped, review-mode qualification write-back

`layer: automation` · `horizon: near-term` · `effort: L` · `feasibility: MEDIUM`

**Problem / opportunity**
Gong's AI Data Extractor is capped at ~20 AI fields/workspace, runs in the background, and **silently overwrites prior values with no review**; methodology data otherwise lives in reps' heads and adherence sits at 40–50% manually. The proven fix (Momentum, Oliv, Weflow) is third-party SaaS that **ingests the customer's calls into their cloud.**

> **Feasibility corrections:** (1) **There is no "after a call" trigger** — Gong has no call-processed REST event; "after a call" is either a customer-configured Automation-Rule webhook into an endpoint we build, or **polling** (newest-first scan exists per PR #14, but burns budget). (2) **The `ask_deal` extraction source is self-contradictory** — `ask_deal`/`ask_account` are `requireAdmin`/`requireAllCalls` because they synthesize across calls a rep can't see; feeding that into a **per-rep** governed write **leaks cross-call data**. Extraction must run off the **rep's own visible transcripts**, not `ask_deal`. (3) The entire Salesforce write surface is **greenfield** (no SF client, no jsforce, no Connected App in the repo).

**Why it matters (value)**
The flagship Automation-layer offering. Matches a funded competitor's proven shape while differentiating on **governance**: customer's own self-hosted MCP, their SF customizations, their Gong permissions, **no field cap, review-mode, full audit, supporting quote per field.** CRO-level outcomes GoNimbly can quantify.

**AI-first angle**
Conversation-to-CRM qualification autofill is THE canonical AI-first-CRM capability. We hold full transcripts (Gong's read-only MCP withholds them), so we extract structured qualification with **quote-level evidence and confidence** via stage-aware prompts, then propose governed writes.

**Proposed features** (three honest slices; cut auto-commit from v1)
- [ ] **(v1, Foundation win)** Minimal Write Spine + extraction over the **rep's own visible transcripts only** (never `ask_deal`); **review-mode only** — every change is a proposal with before/after diff, confidence, and the supporting quote, committed only on explicit approve.
- [ ] **(v1)** **Hard pre-write gate:** `visibleCallIds()` must clear **every** supporting call or the proposal is refused. Never overwrite a non-empty field without showing the diff. Tasks idempotent by call id.
- [ ] **(v1)** Configurable framework field map per org (no 20-field cap); **scope v1 to ONE framework (MEDDPICC) + ONE design-partner org's field map.** Stage-aware extraction (early calls don't force late-stage fields).
- [ ] **(v1)** Next-steps capture synced to Salesforce Tasks via `gong_sf_create_task` (idempotent by call id).
- [ ] **(v1)** **Trigger by polling** the newest-first scan; defer the Gong Automation-Rule webhook to v2.
- [ ] **(v2)** Inbound webhook trigger + **offline extraction eval harness** (precision/recall per field on a labeled corpus; per-field thresholds; model-drift detection via the ledger).
- [ ] **(v3, Agentic)** Graduated autonomy / auto-commit of high-confidence/low-risk fields, gated behind eval-harness pass rates.

**Gong dependencies**
transcripts/extensive (full transcript + trackers + Spotlight), participant resolution (PR #12). All reads GA. **No new endpoints.** (`ask_deal` explicitly **not** an extraction source for per-rep writes.)

**Salesforce dependencies**
Write Spine (Composite + upsert-by-external-ID; Task create); describe-object for picklists/record types/validation; the MEDDIC custom-field schema. Writes execute under **one integration user** — Salesforce enforces validation/FLS/picklists but **will not enforce "this rep can see this call"**; that gate is entirely ours.

**Permission & safety**
Writes go through the Write Spine's field-level capabilities + the visible-call check. **Because writes run under a single integration user, the visible-call check is a hard server-side precondition we run BEFORE every write** — the extracted MEDDIC value *is* the leaked content if a private/non-participated call drives it. Review-mode + confidence threshold + change-diff are the controls Gong's Extractor lacks; every commit lands in the ledger with the quote.

**Risks / open questions**
- Extraction precision on noisy/short calls — mis-set MEDDIC erodes trust fast; the eval harness must precede any auto-commit.
- Field-map + prompt tuning is **per-customer consulting effort.**
- Reframe the pitch: lead with the **governance wedge** (self-hosted, permission-gated, review-mode, full provenance, no cap), not "beating Gong's Extractor." **Do not promise the "40–50%→90%+" numbers as our SLA** — cite them as the category ceiling, gated on each customer's eval results.

---

### EPIC: CRM Hygiene Agent — Gong-truth-driven Salesforce field repair (the wedge first-write)

`layer: automation` · `horizon: near-term (on-demand slice)` · `effort: M (on-demand); full = L/XL` · `feasibility: MEDIUM`

**Problem / opportunity**
Autonomous CRM hygiene is the most mature, highest-ROI, lowest-risk agentic use case of 2026 and the safest first write surface, yet most companies still debate whether their CRM data is trustworthy. Our MCP has the conversation truth to detect drift but no mechanism to surface or fix it.

> **Feasibility reality:** detection is shippable on today's read API (trackers, parties, CRM context all wired into `gong_find_calls`). But **(1)** there is **no scheduler** in the repo (only a Slack alert webhook) — the nightly sweep has no substrate today; **(2)** the SF write surface is greenfield; **(3)** describe-object surfaces required/dependent/picklist/record-type metadata but **not validation-rule formula logic**, so "pre-validate against validation rules" is only partly achievable — the reliable oracle is attempting the write; **(4)** **Gong's AI Data Extractor already auto-populates the exact named fields** (decision-maker, next-step date, competitor, use case) — we differentiate on governance/UX (no cap, review-mode, confidence, diff, contradiction detection), not an empty gap.

**Why it matters (value)**
The lowest-risk entry point for the write layer: it **proposes corrections** rather than driving deal stage, building trust before higher-stakes automation. Directly resolves the "is our CRM data trustworthy?" anxiety that is the wedge for everything downstream. Strong standalone GoNimbly offering ("Gong-to-Salesforce Revenue Hygiene").

**AI-first angle**
Autonomous data hygiene with conversation evidence: the agent cross-checks SF field values against what was said on calls (trackers: competitor/pricing; next-step commitments; named decision-makers) and flags contradictions **with the supporting quote.**

**Proposed features** (ship a smaller, defensible wedge; defer the rest)
- [ ] **(v1, on-demand, no scheduler)** Field-drift / contradiction detector as an **on-demand MCP tool** ("audit this opportunity's hygiene against call truth") — compare SF Opportunity fields (Next Step + date, Competitor, Decision Maker, Use Case, Close Date) against conversation signals; flag stale/missing/contradicted.
- [ ] **(v1)** Evidence-linked repair **proposals** — each carries transcript quote / tracker hit / call link + confidence, staged as a before/after diff. **v1 "write" can be a human handoff** (the agent emits the diff + evidence; a person applies it) — read-only SF (GET + describe) is enough to compose valid proposals, sidestepping the full write client on day one.
- [ ] **(v1)** Required-field & validation-aware proposals — respect required fields, dependent picklists, record-type validation via describe-object (caveat: validation-rule formulas aren't exposed).
- [ ] **(Defer)** Scheduled sweep + hygiene scorecard — needs the Trigger Runtime; nightly/weekly cron over each user's owned/managed deals (manager-graph), field-completeness/freshness score per Opportunity.
- [ ] **(Defer)** Per-customer hygiene ruleset (in-scope fields, validation-safe prompts, thresholds) + auto-commit-above-threshold behind a **hard org-level kill switch** and a labeled eval set.

**Gong dependencies**
Reads only: calls, transcripts, trackers, stats. Scheduler **from the Trigger Runtime** (does not exist today). Manager-graph from the permission resolver. **No new endpoints.**

**Salesforce dependencies**
Read current Opportunity/Account values + describe-object to compose valid proposals; **Write Spine** to commit approved repairs (idempotent, audited) — deferred past v1.

**Permission & safety**
Proposals only; every repair routes through the Governed Write Spine for approval before commit. **Three real gaps to close in the spec before any build:** (1) our model scopes **Gong** visibility, not **Salesforce** record visibility — under one org-wide SF integration user, SF row security is bypassed unless we **explicitly re-scope writes to the user's owned/managed deals AND honor SF sharing/OWD**; (2) proposals carry quotes → extend the owner-only-private invariant (PR #16) to the **evidence-rendering path** so a private call's content can't leak via a proposal; (3) `crmWrite` maps to Gong's `crmDataImport/crmDataInlineEditing` — that's authority to edit CRM data **in Gong**, not Salesforce — a **new SF-sourced capability or GoNimbly-configured allowlist** is required.

**Risks / open questions**
- False-positive contradictions erode trust faster than they save time — needs precision tuning, quote evidence, a labeled eval set before any auto-commit.
- Reading current SF values at scale within budget (batch describe/query).
- Honest sizing: the **on-demand detector slice is M**; the full scheduled, auto-committing agent is **L/XL** once the SF client + Write Spine + scheduler + eval set are counted.

---

### EPIC: Coaching-at-Scale Console — manager-facing conversational coaching across the team

`layer: automation` · `horizon: near-term` · `effort: M` · `feasibility: HIGH`

**Problem / opportunity**
Managers can't manually review every rep's calls. We expose scorecard/interaction stats and coaching data, but there's no conversational layer that ranks reps by coachable gap, ties a weakness to the specific call moment, or turns a coaching insight into an assigned action. The manager-graph expansion is underused for it.

> **Feasibility note (this is the strongest EPIC):** every Gong read dependency exists, is wrapped, **and is already scoped** (`getCoaching`, scorecard/interaction/by-period stats, transcripts, manager-graph). `scopeStats` already intersects requested userIds with the visible set and denies on empty; `getCoaching` already restricts `managerId` to the coaching-visible set; owner-only-private is re-imposed even for all-access callers (closes the leak vector for a coaching console). Read-only v1 needs **no new infra.** Gong scorecards are **read-only** (no submit API) — "reads scores and trends, never submits" is correct.

**Why it matters (value)**
Makes the manager's recurring coaching workflow a one-question interaction grounded in real call evidence, and (with the SF bridge) closes the loop by creating the coaching task — moving from flag-the-gap to assign-the-fix. A differentiated RevOps coaching offering that respects exactly who a manager may coach.

**AI-first angle**
The brain plays sales coach: scans scorecards + interaction stats + tracker patterns, identifies the highest-leverage coachable gap per rep, links it to the demonstrating transcript moment, and proposes a concrete coaching action. With graduated autonomy, a coaching task for a direct report can auto-execute; sensitive ones notify or wait.

**Proposed features** (split hard along the read/write seam)
- [ ] **(v1, read-only, ~M — ship first)** `gong_team_coaching_scan` composing `getCoaching` + scorecard/interaction stats + activity-by-period + transcript evidence → per-rep `{top coachable gap, trend arrow, example callId+speaker+timestamp}`, all flowing through existing `scopeStats`/`getCoaching`/owner-only enforcement.
- [ ] **(v1)** Skill-trend tracking — week-over-week per rep per coaching dimension using scorecard + interaction stats (activity-by-period already exists — no new endpoint).
- [ ] **(v1)** Evidence-linked coaching moments — **require a cited transcript span for every asserted gap** (fail the assertion if no evidence resolves); frame gaps as "coaching opportunities," not scores; degrade gracefully to interaction-stats-only when the org lacks meaningful scorecards/trackers.
- [ ] **(v2, defer behind the SF Write Spine)** Coaching action write-back — create a Salesforce next-step/coaching Task (`WhoId`=rep), risk-tiered: auto for a direct-report task, notify/approve for anything compensation-adjacent or cross-team. **Consume the Write Spine's risk-tier + approval-queue + audit primitives — do not build `createTask` tiering inside this EPIC** (today `createTask` is a flat `techAdmin` gate). Until then, emit a structured "proposed coaching action" the manager confirms.

**Gong dependencies**
`/v2/coaching` (`getCoaching`, manager-bounded), `/v2/stats/activity/scorecards` + interaction + activity-by-period (all wrapped, self-scoped), `/v2/settings` scorecards/trackers/coaching, transcripts for the evidence moment. **Scorecards are read-only.** Pull-based by design (manager asks) — the no-webhook gap doesn't block it. **No new endpoints.**

**Salesforce dependencies**
Optional write only, via the Write Spine: create a coaching/next-step Task (`WhoId`=rep). **Ships read-only without SF.**

**Permission & safety**
Strictly manager-graph bounded — `scopeStats` intersects and denies on empty; `getCoaching` restricts to the visible set; owner-only-private re-imposed on the evidence pull so a private call the manager doesn't own can't leak. People-sensitive (performance) data, so the **evidence-required, never-auto-punitive, audit-trail** rules are product/UX guardrails the brain must honor — these are **not** enforced by the permission layer and need their own guardrail + audit.

**Risks / open questions**
- Inferring a coachable gap from stats + trackers is heuristic — must cite the moment and avoid unfair/auto-punitive framing.
- Coaching dimensions depend on configured scorecards/trackers being meaningful.
- The write-back depends on the SF bridge shipping first; the console **must never auto-assign performance actions without a human** in sensitive cases.

---

### EPIC: Pipeline & Forecast Inspector — conversational, signal-based pipeline/forecast inspection

`layer: automation` · `horizon: near-term (Slice 1 only)` · `effort: L–XL staged` · `feasibility: MEDIUM`

**Problem / opportunity**
Reps and managers run pipeline/forecast inspection constantly (the deal scrub), but our stats tools only cover rep activity — no deal-scoring, no pipeline roll-up, no week-over-week movement, no signal-based forecast view; `ask_deal` answers one deal at a time. The market thesis is explicit: static weighted-pipeline rollups are being replaced by **signal-based forecasting from live engagement data.**

> **Feasibility reality:** per-deal signals are real via `/v2/calls/extensive` CRM context + parties + trackers (**not** stats, which are rep-keyed). Gong forecast/likelihood/webhooks are **not** in the public API. **`ask_deal` fail-closes for restricted-visibility callers — the rollup audience — so it cannot be the backbone.** "SF reads run as the rep" is **false today** (no per-rep SF identity). Honest effort is **L→XL**; only **Slice 1 is near-term.**

**Why it matters (value)**
A conversational forecast-inspection surface grounded in conversation truth, not stale CRM fields: rank the commit by engagement health, surface deals gone quiet, detect momentum changes, explain each with call evidence. The manager-facing half of the revenue brain (Clari's lane, conversation-native and permission-faithful).

**AI-first angle**
The brain reasons across the whole visible book at once — ranking and explaining, not dumping a list. It composes Gong engagement signals (cadence, silence, stakeholder count, tracker hits) via the shared Deal Intelligence library into a per-deal health view and narrates the delta since last week.

**Proposed features** (three slices; only Slice 1 is shippable now)
- [ ] **(Slice 1, ships on today's API)** `gong_pipeline_inspect` as a **point-in-time, conversation-only** inspector over a scoped set of Opportunity IDs (or rep/team scope): build the deal→calls map from the policy-filtered extensive scan, group by context Opportunity ID, compute a **labeled heuristic composite** (last-touch recency, stakeholder count, tracker hits, cadence/silence) with a one-line why + call evidence. Use SF Stage/Amount/CloseDate **that Gong already returns inline** where present; mark deals with no Gong calls as "no conversation signal" rather than inventing a score. Reuse `scopeStats`' visible-set intersection; deny-on-empty.
- [ ] **(Slice 2, after the SF read client + run-as-rep gating land)** Direct SF read for `ForecastCategory`/commit definition and zero-call pipeline deals, with **our-layer visible-set intersection enforced (not SF FLS alone)**; then the commit/best-case rollup + forecast-call-prep digest become correct.
- [ ] **(Slice 3, after the snapshot store lands)** Week-over-week movement detection (gone-quiet, momentum-building, new-competitor-entered) — needs the durable per-scope snapshot store from the Trigger Runtime.
- [ ] **(Cut from v1)** Reliance on `ask_deal` for the rollup narrative (fail-closes for the restricted audience) — use it only as optional enrichment for unrestricted callers; never position the score as Gong/Clari-grade prediction.

**Gong dependencies**
`/v2/stats` (self-scoped) + `/v2/calls/extensive` (trackers + parties for stakeholder counting); `ask_deal` for optional narrative. **No Deal Likelihood / forecast API** → the health score is OUR labeled composite. Movement detection needs the persisted snapshot store.

**Salesforce dependencies**
Slice 2+: read Opportunity Stage/Amount/CloseDate/ForecastCategory/owner via the Write Spine's SF client (read-only) — **the first real-SF read path; does not exist today.** No SF writes.

**Permission & safety**
Stats already intersect + deny-on-empty; manager roll-ups reuse the visible-managers gate. **One real leak to close:** "SF reads run as the rep" is false — a single integration user's FLS/sharing would bypass our gate, so we **must intersect SF-returned Opportunities against the Gong visible-set in OUR layer (fail-closed)** or stand up per-user SF OAuth before any SF read ships. Snapshots are per-caller-scoped so movement history never leaks across the gate. Read-only.

**Risks / open questions**
- Slices 2–3 are gated behind **two large infra prereqs** (SF read client; durable snapshot store) — honest effort L→XL.
- The health score is an **explainable, labeled heuristic**, never Clari/Gong-Predictor parity.
- Manager-graph roll-up correctness depends on the ~1h permission snapshot's reporting tree being current.

---

### EPIC: Smart Trackers & Scorecards Signal Layer

`layer: automation` · `horizon: near-term` · `effort: M` · `feasibility: HIGH`

**Problem / opportunity**
We list trackers/scorecards and aggregate scorecard stats, but no tool says "on THIS call, which trackers fired and where, and what did the scorecard say" — the per-call signal that is the automation fuel. Tracker hits ride inside `getExtensiveCalls` content but are never surfaced as discrete, write-ready signals. Scorecards are read-only in Gong (no submit API), so the value is **extraction.**

> **Two feasibility corrections that change the build:**
> 1. **Trackers are richer than assumed and the timestamp shape is RESOLVED** — `/v2/calls/extensive` supports `trackerOccurrences`, each carrying `speaker_id` + `start_time` (seconds). No live probe needed; just add the selector + a new content type. (Our code surfaces only `{name,count}` today.)
> 2. **Scorecards do NOT ride in extensive content** (the EPIC's biggest factual error). Per-call scorecard answers come from `POST /v2/stats/activity/scorecards` (already wrapped) — returns `AnsweredScorecard` records with `call_id`, `reviewed_user_id`, `review_time`, `scorecard_id`, `visibility_type`, and an `answers[]` array. So the gap detector is built on the **stats endpoint, not extensive.**

**Why it matters (value)**
Trackers and scorecards are Gong's most underused structured signal. Extracting "competitor-mentioned-4-times," "pricing-tracker-fired," or "scorecard-flagged-weak-discovery" per call gives RevOps **deterministic, explainable** inputs for Salesforce field updates — more trustworthy than free-text LLM extraction alone. The shared signal substrate the hygiene, MEDDIC, deal-review, and pipeline EPICs all consume.

**AI-first angle**
Gives the agent **deterministic Gong-native evidence** ("the Pricing tracker fired at 12:04") to ground a CRM proposal, reducing hallucination risk on field writes. Tracker/scorecard signals become the **high-confidence tier that can auto-commit** while free-text extraction stays in review-mode.

**Proposed features** (three slices; first two are clean near-term wins)
- [ ] **(Slice 1, highest-confidence)** `gong_get_call_signals` — extend the extensive selector to pull `trackers` + `trackerOccurrences`, emit a compact per-call digest `{tracker:name, count, occurrences:[{atSeconds, speakerId}]}`. Tracker-only; rides the already-safe extensive policy path.
- [ ] **(Slice 2)** `gong_scan_tracker_hits` across a date/rep range on the **discovery scan engine** (policy-safe by construction) — find calls where a named tracker fired.
- [ ] **(Slice 3, gated on a safety task)** Scorecard gap detector via `getScorecardStats(call_id-keyed)` mapping answers to methodology gaps — **plus the mandatory `call_id` visibility re-filter** (see safety). Do **not** ship per-call scorecard signals until that filter is in and tested.
- [ ] **(Defer to the Write Spine)** Tracker→field-proposal mapper (config) — emits a write **proposal only**; blocked until the Write Spine defines a proposal schema. Ship a stub that emits the raw signal, not a SF-field-named proposal.

**Gong dependencies**
`POST /v2/calls/extensive` (`trackers` + `trackerOccurrences`), `POST /v2/stats/activity/scorecards`, `GET /v2/settings/trackers`, `GET /v2/settings/scorecards` — all wrapped, all GA. Scorecards **read-only.**

**Salesforce dependencies**
None land here — emits structured input only; the actual write is deferred to the Write Spine + Governed Write Spine.

**Permission & safety**
Trackers are policy-safe **by construction** (extensive routes through `getExtensiveCalls` → `isVisibleCall` + owner-only-private). **Scorecards are NOT** — `getScorecardStats` only applies `scopeStats` (a *user*-intersection), **not** per-call visibility, and an `AnsweredScorecard.call_id` can point at a private/non-visible call even when the reviewed user is visible. **Hard requirement (not optional):** after fetching, intersect every returned `call_id` against the same `isVisibleCall`/`visibleCallIds` gate the transcript path uses, drop records that aren't owner-visible, and honor `visibility_type`. Add a `policyClient` test mirroring `policyClient.private.test.ts`. The "zero new risk" claim holds **only after** this re-filter.

**Risks / open questions**
- Tracker→field mapping is org-specific config (a GoNimbly delivery surface).
- Scorecard read-only means the value only materializes once the Write Spine lands proposals in SF.
- Re-scope the EPIC's premise to drop the false "scorecards from extensive content" and "trackers never surfaced" claims.

---

### EPIC: Post-Call Trigger Runtime — Gong-webhook + scheduler to propose → gated write

`layer: automation` · `horizon: near-term (Slices 1–2)` · `effort: M (Slices 1+2); L if Slice 3 pulled in` · `feasibility: MEDIUM`

**Problem / opportunity**
Verified: everything is synchronous and human-initiated; the only timer is the session-GC `setInterval`. No listener for call-processed, no scheduler, no durable job store, no per-account state. **The "no-webhooks" assumption is only half-true:** Gong **does** emit outbound webhooks via admin Automation Rules (token or signed-JWT auth) on call-processed — we just have no receiver, capping the product at the Foundation layer.

> **Feasibility correction:** the webhook action is **call-triggered ONLY.** Gong's CRM-change triggers (Account/Opportunity created/updated, date-based) exist but **cannot fire an outbound webhook** — they only drive AI-Brief generation and Flow enrollment. So the **polling scheduler is load-bearing, not optional:** any deal-stage/amount/close-date reaction **must** come from polling. Reclassify the EPIC's "deal-change triggers NOT confirmed" to **"confirmed unavailable via webhook; poll-only."** Also: `quota.ts` hard-codes `DAILY_LIMIT = 50,000` while Gong's documented default is **10,000/day** — the poller must key off the **real negotiated limit.**

**Why it matters (value)**
The cheapest path to event-driven behavior on **today's** Gong API, and the shared event+execution spine that lets Activity Auto-Capture, MEDDIC Autopilot, and CRM Hygiene run **without a human pressing go** — converting the offering from "a tool the rep calls" to "a system that acts after every call."

**AI-first angle**
Implements the ambient-agent reference architecture (event source → router/filter → reasoner over our 52 tools → gated executor → feedback to an agent inbox) with the notify/question/review trichotomy — the honest near-term version of the "before-the-human-moves-on" loop, scoped to Gong's multi-hour processing latency.

**Proposed features** (three shrinking slices — do **not** build the durable engine first)
- [ ] **(Slice 1, the actual MVP — weeks)** Webhook receiver + **JWT/RSA signature verification** + idempotency on call ID + **identity resolution** (`PermissionResolver.resolvePolicy(primaryUserId, email)` — already exists, resolves any user's policy from the cached snapshot with no session) + relevance router using **only payload fields** (drop internal calls, sub-duration, no-open-Opportunity via the payload's `context[]`) + enqueue to a **single durable store** (one Postgres table: events + dedupe key + status). **No scheduler, no suspend/resume yet.** Use Slice 1 to live-measure post-call webhook latency and whether webhook delivery counts against the REST quota (it likely does **not** — outbound push, not REST pulls — but confirm).
- [ ] **(Slice 2)** Polling scheduler for deal-change reactions (now justified as the **only** path to CRM-trigger reactions), strictly paced against the **real** 10k/day limit via `quotaTracker`.
- [ ] **(Slice 3, defer — possibly its own EPIC)** Durable-execution suspend/resume backbone for multi-day approval-gated workflows + per-account/per-deal state store. **Start with a lightweight DB-backed queue, not self-hosted Temporal** — Temporal is heavy ops for a 2-service shop, and you don't need respawn-safe approval-survival until a gated Write Spine exists to feed it.

**Gong dependencies**
Gong Automation Rules / outbound webhooks on call-processed (token or signed-JWT, RS256; receiver verifies signature, `exp`, `webhook_url` claim, and `body_sha256`). Payload carries `metaData.id` (idempotency), `metaData.primaryUserId` (policy resolution), `parties[]` (internal/external filtering), and `context[]` (Salesforce Opportunity/Account linkage — enables the relevance filter **without** a CRM read). **Fires only AFTER processing completes (hours, not real-time).** Per-org onboarding needs the customer's Gong tech-admin to hand-configure the Automation Rule + secret (no API to provision rules).

**Salesforce dependencies**
**None at ingress** — the webhook payload already embeds the SF linkage in `context[]`. SF enters later as a gated tool step inside the Write Spine. Caveat: `context[]` reflects Gong's last CRM sync and can lag live SF — reinforcing that the poller (or a downstream SF read) is essential.

**Permission & safety**
An ingested event is **not** a logged-in user, so we resolve the **call owner's** policy and run downstream actions under **that rep's** fail-closed permissions — never ambient god-mode. **Two items not to skip:** (1) **bar break-glass/admin identities from autonomous runs at enqueue time** (an admin-owned call would resolve to org-wide visibility and an autonomous action could touch any account); (2) if `primaryUser` can't be resolved to an active profile member, **halt — don't degrade-and-write.** The receiver verifies Gong's signature before trusting any payload. No write at ingress; idempotency on call ID prevents duplicate enqueues.

**Risks / open questions**
- Multi-hour webhook latency must be marketed as **near-real-time post-call**, not real-time.
- Whether webhook delivery counts against the REST quota — **live-test in Slice 1.**
- Build-vs-embed for the durable engine affects self-hosting ops burden — defer the decision to Slice 3.

---

### EPIC: Deal Intelligence & Forecasting Signal Feed

`layer: automation` · `horizon: near-term (Phase 1)` · `effort: L staged` · `feasibility: MEDIUM`

**Problem / opportunity**
Forecasting and AI Deal Monitor are Gong **product** features with **NO API** (Forecast product-only; Deal Monitor warnings live in the board UI). Our stats tools cover rep activity, not deal health; `ask_deal` answers point questions but synthesizes nothing structured. No tool says "these deals have gone quiet / have no decision-maker engaged / haven't discussed pricing" — the signal-based forecasting inputs the 2026 market treats as table stakes.

> **Feasibility note:** the 8 warning types are confirmed exactly (No activity, Ghosted, Overdue, Not enough contacts, No power, Pricing not mentioned, Red flag, Stalled in stage) and confirmed **not** API-exposed — so "re-derive, don't fetch" is correct. **Salesforce reads/writes here are fiction in the repo today** (no SF client). **Stalled-in-stage / Overdue genuinely need SF Stage/Close-Date** and are blocked on the SF read client. The call-completed webhook gives incremental freshness (it carries Opportunity context incl. `StageName`), but **stage transitions still need polling.**

**Why it matters (value)**
Closes the gap where incumbents flag risk but the analysis sits in a UI you can't act on. Hosted as a **reusable library** so the deal-review, hygiene, pipeline-inspector, and agentic EPICs share **ONE** risk derivation, not four — producing structured, evidence-linked signals that feed Salesforce forecasting fields, next-step tasks, and the agentic loop.

**AI-first angle**
The agent gets a **structured risk vector per deal** with linked transcript/tracker evidence — so it can both *explain* risk ("Ghosted: buyer silent 14 days") and *prescribe* a next-best-action as a gated Salesforce task: flag → prescribe.

**Proposed features** (Phase 1 ships now; Phase 2 is dependency-gated)
- [ ] **(Phase 1, no new infra)** `gong_deal_risk_signals` — a **stateless shared library** re-deriving the **5 signals computable from Gong primitives alone**: Ghosted/No-activity (last-inbound timing), Not-enough-contacts/No-power (party affiliation + titles), Pricing-not-mentioned (tracker absence) — each with **policy-filtered linked evidence** and per-customer thresholds.
- [ ] **(Phase 1)** `gong_deal_brief_synthesis` — compose `ask_deal` + `generate_brief` + risk signals into one structured deal-health object (status, risks, evidence, suggested next step). (Inherits Gen-AI Beta + MCP Server Beta gating.)
- [ ] **(Phase 2, blocked on SF read client)** Stalled-in-stage + Overdue — drop or stub until an SF Stage/Close-Date read exists (or accept Gong-stage-only proxies).
- [ ] **(Phase 2, blocked on snapshot store)** `gong_engagement_momentum` (week-over-week call frequency, multi-threading breadth, buyer talk-time trend) and the Pipeline-movement digest — ship a **point-in-time** momentum snapshot first; add deltas when history storage exists.
- [ ] **(Defer, gated)** All SF field/task write-back — behind the Write Spine + an FLS-aware SF capability.

**Gong dependencies**
`POST /v2/calls/extensive` (parties, trackers, content), `POST /v2/stats/interaction`, `ask-entity`, `get-brief` — all wrapped. Native Deal Monitor/Forecast **not** API-exposed → re-derive (additive). Optional: call-completed Automation-Rule webhook for incremental freshness.

**Salesforce dependencies**
Reads Opportunity Amount/CloseDate/Stage via the SF read client to anchor Stalled/Not-enough-contacts — **hard dependency on the unbuilt SF client.** Signals/momentum write into SF forecasting/risk fields + tasks via the Write Spine (gated, downstream).

**Permission & safety**
All synthesis runs on the injected policy client → only permitted calls/deals. **Two leak risks to bake in:** (1) a per-deal risk vector aggregates many calls — **filter every constituent call through the visible-set + owner-only-private BEFORE composing the vector**, or a manager digest could surface evidence from a private/out-of-tree call; (2) momentum/count math must be computed **only over the viewer's visible set**, or call-count leaks existence-level signal about restricted activity. Manager digests reuse the coaching-visibility gate. Pure read; writes deferred and gated.

**Risks / open questions**
- Re-derived risk won't match Gong's native scores — position as "evidence-backed MCP-native risk," **validated against Gong's own warnings on a pilot org** before trusting at-risk flags.
- No-power depends on uneven party-title data; momentum math needs tuning per motion.
- Confirm no deal-level webhook before committing to polling (confirmed: poll-only).

---

### EPIC: Self-Driving Deal Desk — north-star ambient agent, Gong-signal-fed, Salesforce-write, fully gated

`layer: agentic` · `horizon: north-star` · `effort: XL` · `feasibility: BLOCKED (do not roadmap as one deliverable; sequence dead last)`

**Problem / opportunity**
Even with media, Ask-Anything, signals, deal intelligence, the SF write spine, guardrails, and webhooks shipped, **nothing orchestrates them** into the autonomous "call-ends → CRM-updated → next-step-created → SE-notified" loop the 2026 self-driving-CRM thesis defines, nor the scheduled deal-scrub that **prescribes.** Incumbents (Gong, Clari) flag risk but the scrub, CRM update, and forecast commentary still sit with humans — the named unfilled prize. This EPIC **composes the prior EPICs and sequences last.**

> **Why "blocked," honestly:** (1) **Two pillars may never become GA** — call-level Spotlight/next-steps retrieval is **alpha** (`get-brief` is for CRM entities, not calls), and the **8-warning deal-risk taxonomy / Deal Monitor / likelihood / forecast have NO public API** (we'd re-derive from scratch). (2) It depends on **4–5 unbuilt foundational EPICs** (Write Spine, Governed Write Spine, Trigger Runtime, shared Risk library) plus an **always-on agent runtime** and a **non-interactive run-as identity resolver** — none of which exist. Keep it on the roadmap as the **sequenced endpoint**, but every honest near-term increment is one of its prerequisites, not this EPIC.

**Why it matters (value)**
The differentiated, sellable endpoint: the only permission-gated, Salesforce-native conversation-to-CRM execution loop that runs on a customer's **own** self-hosted Gong MCP under their **own** Gong permission profiles. Closes the autonomous-CRM-execution-without-babysitting gap responsibly — auto where safe, human-in-the-loop where it matters, fully audited — exactly the governance Agentforce's multi-agent seam leaves underspecified.

**AI-first angle**
Full ambient-agent realization: event source (Gong webhook + cron), reasoner (our tools + shared risk library), gated executor (Salesforce writes), feedback (agent inbox with notify/question/review). Re-derives the 8-warning taxonomy and **prescribes** next-best-actions as gated Tasks with linked transcript evidence — flag → prescribe → execute. Graduated autonomy starts fully supervised and earns auto-commit per tool; per-account memory means it knows what it already logged and promised.

**Proposed features** (carve one real, supervised slice; defer the rest)
- [ ] **(Shippable first slice — "post-call CRM activity logger, fully supervised")** On the existing Gong Automation-Rule webhook (metadata only), enqueue a job; call `gong_call_summary` / `gong_ask_deal` (GA, fixed windows) to draft **ONE** thing — a Salesforce Task/Activity logging the call with a transcript-quote snippet — and **park it in the approval queue as a proposal only.** No auto-commit, no field updates, no Amount/Close-Date/stage, no email send, no nightly scrub. This forces us to build exactly the reusable primitives as their own scoped EPICs.
- [ ] **(Defer)** Post-call orchestration workflow — assemble the Gong package (Spotlight, tracker/scorecard signals, deal-risk delta, next-steps) and draft a full Salesforce write set as one durable-backbone workflow.
- [ ] **(Defer)** Scheduled deal-scrub that prescribes — nightly cron emitting the 8 re-derived warnings WITH quote evidence and a concrete proposed gated NBA; manager-graph routing to owner AND manager.
- [ ] **(Defer)** Risk-tiered write gate + one-tap approval queue (reuses the Governed Write Spine); follow-up email **drafts proposed, never auto-sent.**
- [ ] **(Defer)** Graduated autonomy + per-account memory — auto-commit low-risk only after trust is earned; per-deal state prevents repeated/contradictory actions. **Make auto-commit-eligible fields ORG-POLICY config, never code defaults.**

**Gong dependencies**
Composes ALL the Gong-capability EPICs (webhook ingress + scheduler, media/Spotlight, trackers/scorecards, ask-entity/brief, shared Deal-Risk library, interaction stats). Inherits their constraints: multi-hour post-call latency, 3 req/s + 10k/day budget, read-only scorecards, **no native Deal Monitor/forecast API**, and **alpha** call-Spotlight retrieval.

**Salesforce dependencies**
Write-back via the Write Spine (OAuth JWT Bearer run-as-rep): Task/Event, Opportunity field updates, OpportunityContactRole, follow-up Tasks; Composite (`allOrNone`, 25-subrequest cap, cumulative governor limits — chunk a nightly scrub carefully); upsert-by-external-ID; record snapshots for undo handles. **Depends entirely on the Write Spine + Governed Write Spine.**

**Permission & safety**
The whole point. Every write flows **first** through our fail-closed per-user gate (`requireCapability` + `visibleCallIds` confirming the rep could see the justifying call) and **second** through Salesforce FLS/sharing as the run-as rep — double-gated, single audit trail. **The single biggest unsolved risk is the scheduled/triggered-run identity layer:** which Gong principal an event-driven run acts as. Gong creds are org-wide, so the ambient agent runs with full-org visibility by default; the gate **must run as the resolved owner's profile, fail-closed, BEFORE any content is read** — or you have a confused-deputy path leaking a private call's content into a CRM field. Risk-tiered HITL: pricing/Amount/Close-Date/stage and any send require explicit approval. Immutable, reversible ledger on every action.

**Risks / open questions**
- Identity-mapping between org-wide Gong creds and SF run-as-rep, and which principal a triggered run assumes — the crux shared with the agentic loop and the A2A EPIC.
- Compounding error across the multi-step seam; always-on token + Gong/SF API cost under tight limits; whether customers trust autonomous stage/Amount changes **at all** (start 100% human-approved).
- Multi-hour latency limits "before-the-human-hangs-up" to "before-they-fully-context-switch."

---

### EPIC: Agentforce / A2A Citizen — our governed write bridge as a first-class external agent

`layer: agentic` · `horizon: north-star` · `effort: L (read-slice = S/M)` · `feasibility: MEDIUM`

**Problem / opportunity**
Gong's June-2026 MCP is read-only (no writes, withholds transcripts); Clari+Salesloft's is execution/Cadence-centric with thin write-governance; Salesforce ships Atlas 3.0 + A2A multi-agent orchestration (GA June 15, 2026) but **underspecifies approval gates, rollback, and audit for agent writes.** There's an open lane — no incumbent offers a permission-gated, Salesforce-native, conversation-to-CRM **write** bridge — but to capture it we must be **discoverable and trusted** by the orchestrators buyers already run.

> **Feasibility corrections:** (1) **The identity bridge is LESS unsolved than feared** — we never had per-user Gong OAuth; we resolve identity by **verified email** against org-wide creds. Mapping an external orchestrator's user context only requires extracting a verified email from the inbound token, then reusing the existing resolve→policy chain — plus accepting/verifying a Salesforce-propagated **RFC 8693 token-exchange** identity (documented and GA). (2) **Salesforce's own GA hosted MCP already does governed, run-as-user Salesforce writes** — so our differentiation is **not** "Salesforce-native writes," it's **Gong-visibility-gated, transcript-grounded, owner-only-private-safe actions with a cross-system approval/rollback ledger.** Lead with that or risk commoditization. (3) The "Write Spine (run-as-rep)" this EPIC leans on has **zero code** in the repo — it's an unbuilt prerequisite.

**Why it matters (value)**
Positioning + distribution + the explicit GoNimbly revenue play. Our bridge becomes a specialist agent Agentforce's orchestrator delegates Salesforce-write work to, while **our** governance layer supplies the approval/rollback/audit the seam lacks. Packages the whole stack (write bridge + guardrails + ledger + agent-inbox control panel) as the only permission-gated conversation-to-Salesforce write bridge — whose control panel + audit-ledger explorer double as EU-AI-Act / SOC 2 evidence.

**AI-first angle**
Atlas Reasoning Engine 3.0 routes on real-time agent descriptions (descriptions are **load-bearing**), so we ship rich machine-readable **capability + governance manifests** (what each write does, its risk tier, whether it requires approval) and structured I/O so an orchestrator routes correctly and surfaces our HITL requirements. Bi-directional MCP: inbound we're an action source Agentforce delegates to; the notify/question/review trichotomy is part of our manifest.

**Proposed features** (ship the legible read slice now; gate writes behind prerequisites)
- [ ] **(Ship now, S — no new infra)** A2A/Atlas-friendly **READ manifest** — rich machine-readable descriptions + governance metadata on our **existing read tools** (transcripts, summary, brief, `ask_account`/`ask_deal`); register the server as an Agentforce external MCP action source **for READS ONLY.** This captures the transcript-access wedge Gong's MCP withholds, fully covered by existing gates.
- [ ] **(Ship now)** Harden inbound identity — accept + **cryptographically verify** a Salesforce-propagated end-user token (RFC 8693), extract verified email, reuse `resolveGongIdentity`→policy; **FAIL CLOSED when no verified end-user identity is present** (never fall back to a service/blanket identity).
- [ ] **(Prove feasibility, M spike)** Publish a minimal `/.well-known/agent.json` Agent Card and run **ONE** end-to-end Atlas→our-MCP delegation in a sandbox — validate identity-propagation + async-status assumptions against GA with evidence, not prose.
- [ ] **(Defer, north-star, blocked on prerequisites)** The **WRITE** bridge, approval queue, reversible ledger, and agent-inbox control panel + audit-ledger explorer. **Do not register a single write action** until (a) the Salesforce Write Spine exists and (b) the approval-queue + ledger exist and are capability-gated. Expose **only explicitly-defined operations** (no raw endpoint access). Async "pending → poll status" pattern (mirroring our existing `getCrmRequestStatus`) for long-running approval-gated writes, leveraging A2A async task status.

**Gong dependencies**
**No new Gong endpoints** — exposes existing reads (+ later writes) through richer descriptions. Builds on the per-user permission gateway (`PolicyGongClient`, manager-graph) as the policy plane a standalone Salesforce MCP cannot replicate. The transcript-access advantage is inherent (Gong's MCP withholds raw transcripts/message bodies/activity lists).

**Salesforce dependencies**
Interop with Agentforce's native MCP client / A2A + Atlas Reasoning Engine 3.0 (GA). Writes still execute via our Write Spine (run-as-rep, FLS-enforced). Inbound auth upgrade: our `jwt.ts` is HS256 self-issued today — must validate Salesforce-issued JWTs / token-exchange tokens. A2A surface: host a discoverable Agent Card + implement the A2A task lifecycle; external-action registration may require partner security review.

**Permission & safety**
The positioning **is** the safety story: a delegated write must resolve to a real rep's `UserPolicy` and pass our fail-closed Gong gate + risk-tier policy + reversible ledger **BEFORE** any Salesforce write — never the orchestrator's blanket identity. **Non-negotiable invariant:** inbound calls must carry a **cryptographically verified end-user identity** (RFC 8693, not a self-asserted header); if end-user propagation is absent, **fail closed (deny)**, never resolve to a broad policy. **Until the reversible ledger + approval queue exist, register READS only** — any write tool exposed to an orchestrator is ungoverned.

**Risks / open questions**
- Whether Agentforce's external-action security model lets our HITL gates interpose cleanly needs hands-on validation against GA — answer via the spike.
- Risk of **commoditization** if our governance manifest isn't legible, given Salesforce's GA hosted MCP already governs run-as-user writes — re-position the pitch accordingly.
- Effort label L is too low for the full vision (spans 2–3 EPICs); the read-manifest slice is a true S/M.

---

## Sequencing & dependencies

**Do this before that:**

1. **Salesforce Write Spine** is the keystone. It unblocks every write EPIC. Its V1 (one tool, `gong_sf_log_call_activity`, dry-run default, run-as-rep with fail-closed deny) plus the **prerequisite "surface SF `objectId` in discovery output"** must land first. **Run the email→SF-username identity spike with a real customer admin before committing to the L** — it's the gating risk, not the code.
2. **Governed Write Spine** lands second (it has nothing to govern until SF writes exist). Ship its descoped core — dry-run/diff, provenance ledger on one durable store, YAML risk tiers, Slack-based approval path — and **defer rollback + graduated autonomy.** This is the **first persistent state** the server holds; that store also backs the Trigger Runtime and Pipeline Inspector snapshots.
3. **Post-Call Trigger Runtime (Slices 1–2)** is the third foundational pillar for the Automation layer — webhook receiver + identity-on-ingest + relevance router + enqueue, then the polling scheduler. It converts the product from request/response to event-driven.

**The three EPICs that unblock the rest:** Salesforce Write Spine → Governed Write Spine → Post-Call Trigger Runtime.

**Read-only EPICs that ship in parallel, no SF client needed (start these now for fast wins):** Coaching-at-Scale Console (HIGH, already-scoped), Smart Trackers & Scorecards Signal Layer (HIGH — trackers slice), Call Media & Spotlight Export Suite (3 reads), AI Ask-Anything Slice 1, Deal Review Cockpit v1, Deal Intelligence Signal Feed Phase 1. The **shared Deal Intelligence library** (built in the Signal Feed / Deal Review Cockpit) should be authored once and reused by Deal Review, Hygiene, Pipeline Inspector, and the agentic loop.

**Then the write-dependent Automation EPICs** (each consumes both spines): Activity Auto-Capture (Slice 1 first — lowest-risk trust-builder), MEDDIC Autopilot, CRM Hygiene Agent.

**Infra investments the agentic layer requires (none exist today):**
- **Durable datastore** (Postgres/Redis) — provenance ledger, approval queue, per-account/per-deal state, pipeline snapshots. The server is near-stateless today (in-memory quota, fire-and-forget Slack).
- **Scheduler / job runtime** — nightly hygiene sweeps, deal-change polling, snapshot diffs. Today the only timer is session-GC.
- **Salesforce client** (`src/sf/`) — OAuth JWT signer, Connected/External App per org, describe cache, Composite/upsert, read path. Entirely greenfield.
- **Approval surface** — Slack approve/deny links first; agent-inbox UI deferred.
- **Non-interactive run-as identity resolver** — which Gong principal a triggered/scheduled run acts as. `resolvePolicy(userId, email)` already resolves any user's policy from the cached snapshot, so this is plumbing over an existing mechanism — but barring admin/break-glass identities from autonomous runs is mandatory.

**One repo correction to land early:** `quota.ts` hard-codes `DAILY_LIMIT = 50,000`; Gong's documented default is **10,000/day** — any poller must key off the real negotiated limit or it will blow the budget.

---

## North-star EPICs

Two EPICs are explicitly visionary and should be labeled `horizon:north-star`, sequenced last, and **not** promised as near-term:

- **Self-Driving Deal Desk** (`feasibility: BLOCKED`). It composes 4–5 unbuilt foundational EPICs and depends on Gong capabilities that are **alpha or non-existent as API**: call-level Spotlight/next-steps retrieval is **alpha** (request access from Gong), and the 8-warning deal-risk taxonomy / Deal Monitor / likelihood / forecast have **no public API** (we re-derive). **What must be true to make it real:** the Write Spine, Governed Write Spine, Trigger Runtime, and shared Risk library all shipped and trusted in prod; a resolved non-interactive run-as identity model; customer appetite for autonomous stage/Amount changes (start 100% human-approved, earn autonomy with eval data); and ideally Gong promoting call-Spotlight retrieval to GA. **Carve the supervised "post-call activity logger, proposal-only" slice now** to build the reusable primitives without the alpha/auto-commit parts.

- **Agentforce / A2A Citizen** (`feasibility: MEDIUM`, but the write half is north-star). The Salesforce ecosystem (Atlas 3.0, A2A, end-user identity propagation via RFC 8693) is **GA as of June 15, 2026**, so there's no beta blocker for the **read** slice — ship the read manifest + hardened inbound identity + a one-shot sandbox delegation spike now. **What must be true for the write bridge:** the Salesforce Write Spine and the approval-queue+ledger must exist and be capability-gated before a single write action is registered; the A2A cryptographic-identity handshake and external-action HITL-interpose contract must be validated against GA behavior; and our governance manifest must be legible enough to avoid commoditization against Salesforce's own GA hosted MCP (which already governs run-as-user writes — our durable edge is **Gong-visibility-gated, transcript-grounded, cross-system approval/rollback**, not "Salesforce-native writes").

---

## Deliberately out of scope (for now)

Reviewers should know what we considered and folded or cut:

- **Standalone "Ambient Agent Runtime" infra EPIC** — folded into the **Post-Call Trigger Runtime** (durable backbone, per-account memory, run-identity are its children). A near-empty platform-only EPIC reads worse than co-locating the spine with its first consumer.
- **Writing to Salesforce *through* Gong's CRM upsert** (`/v2/crm/entities`) — **rejected as the primary path.** It writes a Gong *shadow* CRM and is explicitly blocked for native-Salesforce-connector orgs (the common case). Useful only for orgs already on Gong's generic CRM API.
- **`gong_upload_call_media`** — cut from the Media Suite. The dormant method is almost certainly broken (JSON body vs the real multipart/binary contract), needs `api:calls:create`, and carries recording-consent compliance weight a read EPIC shouldn't hold. Becomes its own gated-write EPIC if wanted.
- **`gong_ask_lead`** — held until `ask-entity` LEAD support is live-verified; current evidence suggests it returns 404. Don't ship a tool that always fails.
- **Composing a separate Salesforce MCP as the end state** — viable as a fast transitional step, but **forfeits our core differentiator** (the unified, fail-closed, per-user Gong permission gate) — a standalone SF MCP can't enforce "only write to the Opportunity behind a call you were allowed to see." Best used transitionally, not as the architecture.
- **Several duplicate framings merged** — Foundation Salesforce Bridge → Write Spine; Risk-Tiered Guardrails / Autonomous-Action Ledger → Governed Write Spine; multiple webhook/ambient EPICs → Trigger Runtime; Account Research & Brief Studio → Deal Review Cockpit; Self-Driving Revenue Brain / Deal-Scrub Autopilot → Self-Driving Deal Desk. Consolidated to keep the roadmap legible.

---

## Suggested GitHub structure

**File each EPIC as one issue** titled `EPIC: <title>`, body = the EPIC section above (Problem → Risks), with the **Proposed features as the issue's checklist**. Use child issues only where a feature is itself sizeable (e.g., the SF client, the durable store); otherwise keep the checklist inline so the EPIC tracks its own progress.

**Labels:**
- Layer: `layer:foundation` · `layer:automation` · `layer:agentic`
- Horizon: `horizon:near-term` · `horizon:north-star`
- Effort: `effort:S` · `effort:M` · `effort:L` · `effort:XL`
- Feasibility: `feasibility:high` · `feasibility:medium` · `feasibility:blocked`
- Cross-cutting infra: `infra:salesforce-client` · `infra:datastore` · `infra:scheduler` · `infra:approval-queue` — apply to every EPIC that depends on that investment so the critical path is filterable.
- Type: `type:epic` on the parent; `type:feature` / `type:spike` on children.
- Risk flags: `needs:live-verify` (e.g., media-url scope, ask-entity CONTACT/LEAD, webhook-vs-quota) · `needs:customer-onboarding` (Connected App, Automation Rule, External-ID fields) · `safety:gated-write`.

**Milestones (mirror the sequencing):**
1. `M1 — Write Foundation`: Salesforce Write Spine V1 + Governed Write Spine core + Trigger Runtime Slices 1–2.
2. `M2 — Read Wins (parallel)`: Coaching Console, Trackers Signal Layer, Media Suite, Ask-Anything S1, Deal Review v1, Deal Intelligence P1.
3. `M3 — Governed Automation`: Activity Auto-Capture, MEDDIC Autopilot, CRM Hygiene, Pipeline Inspector S2.
4. `M4 — North-Star`: A2A read slice + spike now; Self-Driving Deal Desk supervised slice; full agentic loop last.

**Tracking conventions:** open a top-level **"Roadmap" tracking issue** (or GitHub Project board grouped by `layer`) linking every EPIC, with the at-a-glance table pasted in. Add a **`blocked-by:` line** in each dependent EPIC body referencing the Write Spine / Governed Write Spine / Trigger Runtime issue numbers so the dependency graph is explicit. Tag the three keystone EPICs with a distinct `critical-path` label. Mark `feasibility:blocked` (Self-Driving Deal Desk) clearly in its title/body so reviewers don't schedule it before its prerequisites.