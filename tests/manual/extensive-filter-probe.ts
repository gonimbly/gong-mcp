/**
 * Live probe of /v2/calls/extensive capabilities — manual, against the REAL
 * Gong API. Never runs in CI. Read-only: only POST /v2/calls/extensive is hit,
 * which is a query endpoint.
 *
 * Answers the open questions from docs/backlog-call-discovery-tools.md before
 * the call-discovery composite tools are built on top of this endpoint:
 *
 *   A. baseline   — which metaData/party fields actually come back (url deep
 *                   link? party name/affiliation?), and how big a raw page is
 *                   (the "before" token-cost baseline for compact summaries)
 *   B. primaryUserIds — does the extensive filter accept it, and does it
 *                   actually narrow results to that primary rep?
 *   C. CRM context — does contentSelector.context = "Extended" attach CRM
 *                   account objects, what shape, and what % of calls have one?
 *   D. strictness — how the endpoint behaves with a missing/empty filter, so
 *                   the unit-test fakes can be exactly as strict as the API.
 *
 * Credentials (either):
 *   - GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET / GONG_BASE_URL env vars, or
 *   - a keychain OAuth token from a prior `gong_login` (local dev)
 *
 * Run:  npm run probe:extensive-filter
 *       npm run probe:extensive-filter -- someone@gonimbly.com
 */
import { GongClient } from "../../src/gong/client.js";
import { resolveGongIdentity } from "../../src/gong/identity.js";

const EMAIL = (process.argv[2] ?? "iulyan.ramos@gonimbly.com").toLowerCase();

const raw = new GongClient();

const range = {
  fromDateTime: new Date(Date.now() - 14 * 86400_000).toISOString(),
  toDateTime: new Date().toISOString(),
};

interface ExtensivePage {
  calls?: Array<{
    metaData?: Record<string, unknown>;
    parties?: Array<Record<string, unknown>>;
    context?: unknown;
    content?: unknown;
  }>;
  records?: { totalRecords?: number; currentPageSize?: number; cursor?: string };
}

const kb = (obj: unknown) => (JSON.stringify(obj).length / 1024).toFixed(1);
const fieldNames = (objs: Array<Record<string, unknown> | undefined>) => {
  const keys = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o ?? {})) keys.add(k);
  return [...keys].sort().join(", ");
};

console.log(`\n— Identity (${EMAIL}) —`);
const identity = await resolveGongIdentity(raw, EMAIL);
if (!identity) {
  console.error("No Gong user for that email; aborting.");
  process.exit(1);
}
console.log(`Gong user ${identity.userId} (${identity.fullName ?? "?"})`);

// ── A. Baseline: field shapes + raw page weight ───────────────────────────────

console.log(`\n— A. Baseline scan (last 14 days, parties only) —`);
const baseline = await raw.getExtensiveCalls({
  filter: { ...range },
  contentSelector: { exposedFields: { parties: true } },
}) as ExtensivePage;
const calls = baseline.calls ?? [];
console.log(`  calls on page 1: ${calls.length} of ${baseline.records?.totalRecords ?? "?"} in range`);
console.log(`  raw page size: ${kb(baseline)} KB (${kb(calls[0] ?? {})} KB for first call alone)`);
console.log(`  metaData fields: ${fieldNames(calls.map((c) => c.metaData))}`);
console.log(`  party fields:    ${fieldNames(calls.flatMap((c) => c.parties ?? []))}`);
const withUrl = calls.filter((c) => typeof c.metaData?.url === "string").length;
console.log(`  metaData.url present on ${withUrl}/${calls.length} calls`);
const affiliations = new Set(calls.flatMap((c) => (c.parties ?? []).map((p) => String(p.affiliation))));
console.log(`  party affiliation values: ${[...affiliations].join(", ")}`);

// ── B. primaryUserIds filter ──────────────────────────────────────────────────
// Probe with a user who IS the primary rep on a call in range (taken from the
// baseline page) — probing with an arbitrary user can't distinguish "filter
// rejected" from "valid filter, zero matches" (both surface as a Gong 404).

console.log(`\n— B. filter.primaryUserIds —`);
const knownPrimary = calls.map((c) => c.metaData?.primaryUserId).find((id) => id != null);
if (!knownPrimary) {
  console.log("  (no call with a primaryUserId on the baseline page — cannot probe)");
} else {
  try {
    const probe = await raw.getExtensiveCalls({
      filter: { ...range, primaryUserIds: [String(knownPrimary)] },
      contentSelector: { exposedFields: { parties: true } },
    }) as ExtensivePage;
    const probeCalls = probe.calls ?? [];
    const honored = probeCalls.every((c) => String(c.metaData?.primaryUserId) === String(knownPrimary));
    console.log(`  ACCEPTED — ${probeCalls.length} calls (of ${probe.records?.totalRecords ?? "?"} matching) vs ${baseline.records?.totalRecords ?? "?"} unfiltered`);
    console.log(`  every returned call has primaryUserId=${knownPrimary}: ${honored}`);
  } catch (err) {
    console.log(`  REJECTED for primary rep ${knownPrimary} — ${err instanceof Error ? err.message.slice(0, 200) : err}`);
  }
}

// ── C. CRM context selector ───────────────────────────────────────────────────

console.log(`\n— C. contentSelector.context = "Extended" —`);
try {
  const probe = await raw.getExtensiveCalls({
    filter: { ...range },
    contentSelector: { context: "Extended", exposedFields: { parties: true } },
  }) as ExtensivePage;
  const probeCalls = probe.calls ?? [];
  const withContext = probeCalls.filter((c) => c.context !== undefined && (!Array.isArray(c.context) || c.context.length > 0));
  console.log(`  ACCEPTED — ${withContext.length}/${probeCalls.length} calls carry a non-empty context`);
  console.log(`  page size with context: ${kb(probe)} KB (vs ${kb(baseline)} KB parties-only)`);
  if (withContext.length > 0) {
    console.log(`  sample context shape:\n${JSON.stringify(withContext[0].context, null, 2).split("\n").map((l) => `    ${l}`).join("\n")}`);
  }
} catch (err) {
  console.log(`  REJECTED — ${err instanceof Error ? err.message.slice(0, 200) : err}`);
}

// ── D. Strictness: missing/empty filter ───────────────────────────────────────

console.log(`\n— D. Strictness —`);
for (const [label, body] of [
  ["bare {} body (no filter key)", {}],
  ['{ "filter": {} } (empty filter)', { filter: {} }],
] as const) {
  try {
    const page = await raw.getExtensiveCalls(body as { filter?: Record<string, unknown> }) as ExtensivePage;
    console.log(`  ${label}: ACCEPTED — ${(page.calls ?? []).length} calls returned`);
  } catch (err) {
    console.log(`  ${label}: rejected — ${err instanceof Error ? err.message.slice(0, 160) : err}`);
  }
}

console.log("\nDone. Record these findings in docs/backlog-call-discovery-tools.md.");
