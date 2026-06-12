/**
 * Live smoke test for the call-discovery composite tools — manual, against the
 * REAL Gong API. Never runs in CI. Read-only.
 *
 * Exercises the src/gong/discovery.ts engine through a real PolicyGongClient
 * (the same wiring the gateway uses) and cross-checks results against
 * independent raw fetches:
 *
 *   - directory:    name → user resolution returns real users
 *   - find calls:   participant scan; one result's parties re-fetched raw and
 *                   re-matched independently
 *   - account scan: a domain taken from a found call's external participant
 *                   must find that same call again
 *   - my calls:     every result contains the persona as a party
 *   - summary:      compact digest (size-bounded), never a transcript
 *   - coverage:     counts are internally consistent and policy-composed
 *
 * Also prints a before/after token-cost comparison: the bytes a model would
 * have ingested paging the raw extensive endpoint itself vs the compact
 * composite-tool output for the same question.
 *
 * Credentials (either):
 *   - GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET / GONG_BASE_URL env vars, or
 *   - a keychain OAuth token from a prior `gong_login` (local dev)
 *
 * Run:  npm run smoke:find-calls
 *       npm run smoke:find-calls -- someone@gonimbly.com "participant name"
 */
import { GongClient } from "../../src/gong/client.js";
import { PolicyGongClient } from "../../src/gong/policyClient.js";
import { PermissionResolver, degradedPolicy } from "../../src/gong/permissionResolver.js";
import { resolveGongIdentity } from "../../src/gong/identity.js";
import { findCalls, findMyCalls, summarizeCall } from "../../src/gong/discovery.js";
import { loadUserDirectory, matchDirectoryUsers } from "../../src/gong/directory.js";

const EMAIL = (process.argv[2] ?? "iulyan.ramos@gonimbly.com").toLowerCase();
const PARTICIPANT = process.argv[3] ?? "Nikki Mitchell";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name} — ${detail}`);
};
const kb = (obj: unknown) => JSON.stringify(obj).length / 1024;

const raw = new GongClient();

// ── Identity + policy client (same wiring as the gateway) ────────────────────

console.log(`\n— Resolving identity for ${EMAIL} —`);
const identity = await resolveGongIdentity(raw, EMAIL);
if (!identity) {
  console.error("No Gong user for that email; aborting.");
  process.exit(1);
}
console.log(`Gong user ${identity.userId} (${identity.fullName ?? "?"})`);

const resolver = new PermissionResolver(raw);
let policy;
try {
  policy = await resolver.resolvePolicy(identity.userId, identity.email);
} catch (err) {
  console.error(`Resolution failed (${err instanceof Error ? err.message : err}) — degraded policy engaged`);
  policy = degradedPolicy(identity.userId, identity.email);
}
const scoped = new PolicyGongClient(identity, policy);

const range = {
  fromDateTime: new Date(Date.now() - 14 * 86400_000).toISOString(),
  toDateTime: new Date().toISOString(),
};

// ── 1. Directory resolution ───────────────────────────────────────────────────

console.log(`\n— gong_find_user equivalent ("${PARTICIPANT.split(" ")[0]}") —`);
const directory = await loadUserDirectory(scoped);
const nameMatches = matchDirectoryUsers(directory, PARTICIPANT.split(" ")[0]);
check("directory: name fragment resolves to Gong user(s)", nameMatches.length >= 1,
  `${nameMatches.length} match(es): ${nameMatches.slice(0, 3).map((u) => `${u.fullName} <${u.email}>`).join(", ")}${nameMatches.length > 3 ? ", …" : ""}`);

// ── 2. find_calls by participant + raw cross-check ───────────────────────────

console.log(`\n— gong_find_calls (participant "${PARTICIPANT}", last 14 days) —`);
const t0 = Date.now();
const found = await findCalls(scoped, { participant: PARTICIPANT, ...range });
const findMs = Date.now() - t0;
const cov = found.coverage;
console.log(`  ${cov.matchedCalls} matched of ${cov.scannedCalls} visible (${cov.pagesScanned} pages, truncated=${cov.truncated}, raw total in range=${cov.totalCallsInRange}) in ${findMs}ms`);
if (found.participantResolution?.note) console.log(`  note: ${found.participantResolution.note}`);

check("find_calls: coverage counts are internally consistent",
  cov.matchedCalls >= found.calls.length && cov.scannedCalls >= cov.matchedCalls &&
  (cov.totalCallsInRange === undefined || cov.totalCallsInRange >= cov.scannedCalls),
  `matched ${cov.matchedCalls} ≤ scanned ${cov.scannedCalls} ≤ raw ${cov.totalCallsInRange ?? "?"} (policy composition)`);

if (found.calls.length === 0) {
  console.log(`  (no calls for "${PARTICIPANT}" in range — pass a different participant as argv[3] for the cross-check)`);
} else {
  const sample = found.calls[0];
  const rawFetch = await raw.getExtensiveCalls({
    filter: { callIds: [sample.id] },
    contentSelector: { exposedFields: { parties: true } },
  }) as { calls?: Array<{ parties?: Array<{ userId?: string; emailAddress?: string; name?: string }> }> };
  const rawParties = rawFetch.calls?.[0]?.parties ?? [];
  const q = PARTICIPANT.toLowerCase();
  const ids = new Set(nameMatches.map((u) => u.userId));
  const independentlyMatched = rawParties.some((p) =>
    (p.userId && ids.has(String(p.userId))) ||
    p.emailAddress?.toLowerCase().includes(q) ||
    p.name?.toLowerCase().includes(q)
  );
  check("find_calls: sample result re-verified against an independent raw fetch", independentlyMatched,
    `call ${sample.id} ("${sample.title?.slice(0, 50)}") has ${rawParties.length} parties, participant present=${independentlyMatched}`);
  check("find_calls: results carry the Gong deep link", Boolean(sample.url?.includes("gong")),
    sample.url ?? "(missing url)");

  // ── 3. Account scan seeded from live data ───────────────────────────────────
  const externalDomain = found.calls
    .flatMap((c) => c.participants)
    .find((p) => p.affiliation !== "Internal" && p.email?.includes("@"))
    ?.email?.split("@")[1];
  if (externalDomain) {
    console.log(`\n— gong_find_calls (account "${externalDomain}") —`);
    const byAccount = await findCalls(scoped, { account: externalDomain, ...range });
    const foundSameCall = byAccount.calls.some((c) =>
      found.calls.some((f) => f.id === c.id &&
        f.participants.some((p) => p.email?.endsWith(`@${externalDomain}`))));
    const sourceCallIds = found.calls
      .filter((c) => c.participants.some((p) => p.affiliation !== "Internal" && p.email?.endsWith(`@${externalDomain}`)))
      .map((c) => c.id);
    check("find_calls: account search finds the call its domain came from",
      sourceCallIds.some((id) => byAccount.calls.some((c) => c.id === id)) || foundSameCall,
      `${byAccount.coverage.matchedCalls} matches for "${externalDomain}"; bases: ${[...new Set(byAccount.calls.flatMap((c) => c.matchedOn))].join(", ")}`);
  } else {
    console.log("  (no external participant in results — skipping account cross-check)");
  }

  // ── 4. Call summary ─────────────────────────────────────────────────────────
  console.log(`\n— gong_call_summary (${sample.id}) —`);
  const digest = await summarizeCall(scoped, sample.id);
  const digestKb = kb(digest);
  check("call_summary: compact and transcript-free", digestKb < 20 && !JSON.stringify(digest).includes("sentences"),
    `${digestKb.toFixed(1)} KB; topics=${digest.topics?.length ?? 0}, trackers=${digest.trackers?.length ?? 0}, keyPoints=${digest.keyPoints?.length ?? 0}, brief=${digest.brief ? "yes" : "no"}`);
}

// ── 5. my_calls ───────────────────────────────────────────────────────────────

console.log(`\n— gong_my_calls (${identity.email}) —`);
const mine = await findMyCalls(scoped, identity, range);
const allContainMe = mine.calls.every((c) =>
  c.participants.some((p) => p.userId === identity.userId || p.email?.toLowerCase() === identity.email));
check("my_calls: every result contains the session user as a party",
  mine.calls.length === 0 || allContainMe,
  `${mine.calls.length} calls (${mine.coverage.matchedCalls} matched of ${mine.coverage.scannedCalls} scanned)`);

// ── 6. Before/after token-cost comparison ─────────────────────────────────────

console.log(`\n— Token-cost comparison for "calls ${PARTICIPANT} was on (last 14 days)" —`);
let rawBytesKb = 0;
let cursor: string | undefined;
for (let page = 0; page < cov.pagesScanned || (page === 0 && cov.pagesScanned === 0); page++) {
  const data = await raw.getExtensiveCalls({
    filter: { ...range },
    contentSelector: { exposedFields: { parties: true } },
    ...(cursor ? { cursor } : {}),
  }) as { records?: { cursor?: string } };
  rawBytesKb += kb(data);
  cursor = data.records?.cursor;
  if (!cursor) break;
}
const compactKb = kb(found);
console.log(`  manual approach (model pages raw extensive JSON): ${rawBytesKb.toFixed(0)} KB across ${cov.pagesScanned || 1} page(s)`);
console.log(`  composite tool (compact result):                  ${compactKb.toFixed(1)} KB`);
console.log(`  reduction: ${(rawBytesKb / Math.max(compactKb, 0.1)).toFixed(0)}× (${(100 - (compactKb / Math.max(rawBytesKb, 0.1)) * 100).toFixed(1)}% smaller)`);
check("token discipline: compact output is at least 10× smaller than the raw scan",
  rawBytesKb / Math.max(compactKb, 0.1) >= 10,
  `${rawBytesKb.toFixed(0)} KB → ${compactKb.toFixed(1)} KB`);

// ── Summary ───────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.pass);
console.log(`\n══ ${results.length - failed.length}/${results.length} checks passed ══`);
if (failed.length) {
  for (const f of failed) console.log(`   FAILED: ${f.name} — ${f.detail}`);
  process.exit(1);
}
