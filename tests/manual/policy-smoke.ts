/**
 * Live policy smoke test — manual, against the REAL Gong API. Never runs in CI.
 *
 * Resolves a real user's Gong permission profile into a UserPolicy, then compares
 * the raw org-wide client against the PolicyGongClient to verify the Phase 3
 * policy layer protects data as expected:
 *
 *   - calls:  visible set justified in both directions (nothing leaked, nothing
 *             wrongly hidden), direct fetch + transcript of a hidden call denied
 *   - cross-workspace: a workspace without a profile fails closed (own data only)
 *   - stats:  out-of-policy userIds denied; default query scoped to the visible set
 *   - AI:     denied unless callsAccess is "all" in the target workspace
 *   - admin:  logs / privacy / profiles / CRM writes gated on capabilities
 *
 * Read-only — no write endpoint is ever called.
 *
 * Credentials (either):
 *   - GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET / GONG_BASE_URL env vars, or
 *   - a keychain OAuth token from a prior `gong_login` (local dev)
 *
 * Run:  npm run smoke:policy           (defaults to the email below)
 *       npm run smoke:policy -- someone@gonimbly.com
 *
 * This found a real bug on 2026-06-11: /v2/users/extensive 400s on a bare {}
 * body, which unit-test fakes happily accepted. Run it against each persona
 * whenever the resolver or policy client changes (see docs/phase3a-discovery.md).
 */
import { GongClient } from "../../src/gong/client.js";
import { PolicyGongClient } from "../../src/gong/policyClient.js";
import { PermissionResolver, degradedPolicy } from "../../src/gong/permissionResolver.js";
import { AccessDeniedError } from "../../src/gong/scopedClient.js";
import { resolveGongIdentity } from "../../src/gong/identity.js";

const EMAIL = (process.argv[2] ?? "iulyan.ramos@gonimbly.com").toLowerCase();
const CUSTOMERS = "2163970312763144602";
const PEOPLE_OPS = "815177878201176809";
const OUT_OF_POLICY_PROBE = "2830045931589947630"; // org-chart root — outside any lead's subtree

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name} — ${detail}`);
};

async function expectDenied(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, false, "was ALLOWED — expected AccessDeniedError");
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      check(name, true, `denied as expected (${err.message.slice(0, 90)}…)`);
    } else {
      check(name, false, `unexpected error: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
  }
}

const raw = new GongClient();

// ── 1. Identity + policy resolution ──────────────────────────────────────────

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

console.log(`\n— UserPolicy (degraded=${policy.degraded}) —`);
for (const [wsId, ws] of policy.perWorkspace) {
  const fmt = (a: { level: string; visibleUserIds: Set<string> | null }) =>
    a.visibleUserIds === null ? `${a.level} (unrestricted)` : `${a.level} (${a.visibleUserIds.size} visible)`;
  console.log(`  workspace ${wsId}: profile "${ws.profileName}"`);
  console.log(`    calls=${fmt(ws.calls)} deals=${fmt(ws.deals)} coaching=${fmt(ws.coaching)} stats=${fmt(ws.stats)} library=${ws.library.level}`);
}
console.log(`  capabilities: ${JSON.stringify(policy.capabilities)}`);

const scoped = new PolicyGongClient(identity, policy);

// ── 2. Calls: raw vs policy ───────────────────────────────────────────────────

console.log(`\n— Calls (last 14 days, Customers workspace) —`);
const range = {
  fromDateTime: new Date(Date.now() - 14 * 86400_000).toISOString(),
  toDateTime: new Date().toISOString(),
};

interface CallParty {
  userId?: string;
  emailAddress?: string;
}
interface CallRecord {
  metaData?: { id?: string; title?: string };
  parties?: CallParty[];
}

// Mirror of PolicyGongClient.isVisibleCall: a party matches by userId in the
// visible set OR by the user's own email (unlinked attendee records).
const hasInPolicyParty = (parties: CallParty[] | undefined, visible: Set<string>): boolean =>
  (parties ?? []).some(
    (p) =>
      (p.userId && visible.has(String(p.userId))) ||
      (p.emailAddress && p.emailAddress.toLowerCase() === identity.email)
  );
interface CallsPage {
  calls?: CallRecord[];
  records?: { totalRecords?: number; cursor?: string };
}

// The API pages at 100 records — follow the cursor so counts reflect the
// full range, not just page 1. Capped to keep the smoke test quick.
const MAX_PAGES = 10;
async function allPages(fetchPage: (cursor?: string) => Promise<CallsPage>): Promise<{ calls: CallRecord[]; total: number }> {
  const calls: CallRecord[] = [];
  let cursor: string | undefined;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(cursor);
    calls.push(...(data.calls ?? []));
    total = data.records?.totalRecords ?? calls.length;
    cursor = data.records?.cursor;
    if (!cursor) break;
  }
  if (cursor) console.log(`  (stopped after ${MAX_PAGES} pages — ${total} total calls in range)`);
  return { calls, total };
}

const { calls: rawList, total: rawTotal } = await allPages((cursor) => raw.getExtensiveCalls({
  filter: { ...range, workspaceId: CUSTOMERS },
  contentSelector: { exposedFields: { parties: true } },
  ...(cursor ? { cursor } : {}),
}) as Promise<CallsPage>);

const { calls: scopedList } = await allPages((cursor) => scoped.getExtensiveCalls({
  filter: { ...range, workspaceId: CUSTOMERS },
  ...(cursor ? { cursor } : {}),
}) as Promise<CallsPage>);
const scopedIds = new Set(scopedList.map((c) => String(c.metaData?.id)));

// No profile in the workspace (and not degraded) → the policy client enforces
// own-calls-only there; verify against that expectation instead of skipping.
const callsAccess = (policy.perWorkspace.get(CUSTOMERS) ?? policy.perWorkspace.get("*"))?.calls
  ?? { level: "none" as const, visibleUserIds: new Set([identity.userId]) };
const hiddenCalls = rawList.filter((c) => !scopedIds.has(String(c.metaData?.id)));
console.log(`  raw org client: ${rawList.length}/${rawTotal} calls in range | policy client: ${scopedIds.size} | hidden: ${hiddenCalls.length}`);

if (callsAccess.visibleUserIds === null) {
  // Compare on "nothing hidden" rather than equal counts: a call recorded
  // between the two fetches would otherwise fail this spuriously.
  check("calls: unrestricted profile sees everything", hiddenCalls.length === 0,
    `${scopedIds.size} visible, ${hiddenCalls.length} hidden of ${rawList.length} raw (callsAccess=all)`);
} else {
  const visible = callsAccess.visibleUserIds;
  const wronglyShown = scopedList.filter((c) => {
    const call = rawList.find((r) => String(r.metaData?.id) === String(c.metaData?.id));
    return call && !hasInPolicyParty(call.parties, visible);
  });
  check("calls: every visible call has an in-policy party", wronglyShown.length === 0,
    wronglyShown.length === 0 ? `all ${scopedIds.size} visible calls justified` : `${wronglyShown.length} calls leaked!`);
  const wronglyHidden = hiddenCalls.filter((c) => hasInPolicyParty(c.parties, visible));
  check("calls: no in-policy call is wrongly hidden", wronglyHidden.length === 0,
    `${wronglyHidden.length} wrongly hidden of ${hiddenCalls.length} hidden`);
}

// A hidden call must be denied on direct access
if (hiddenCalls.length > 0) {
  const target = String(hiddenCalls[0].metaData?.id);
  await expectDenied(`calls: direct getCall(${target}) on a hidden call`, () => scoped.getCall(target));
  await expectDenied(`calls: transcript of hidden call ${target}`, () => scoped.getCallTranscripts([target]));
} else {
  console.log("  (no hidden calls in range — profile sees everything here; deny-path covered by unit tests)");
}

// A visible call must still work
if (scopedIds.size > 0) {
  const visibleId = [...scopedIds][0];
  try {
    await scoped.getCall(visibleId);
    check(`calls: getCall(${visibleId}) on a visible call`, true, "allowed as expected");
  } catch (err) {
    check(`calls: getCall(${visibleId}) on a visible call`, false, `unexpectedly denied: ${err}`);
  }
}

// ── 3. People Ops workspace (no profile there → own data only) ───────────────

console.log(`\n— People Ops workspace (fail-closed check) —`);
const poWs = policy.perWorkspace.get(PEOPLE_OPS) ?? policy.perWorkspace.get("*");
// First page is enough for a smoke check of this workspace.
const poCalls = await scoped.getExtensiveCalls({ filter: { ...range, workspaceId: PEOPLE_OPS } }) as CallsPage;
// No profile in the workspace (undefined) means own-calls-only; an unrestricted
// profile (visibleUserIds === null) means there is nothing to hide. Don't conflate them.
const poVisible: Set<string> | null = poWs ? poWs.calls.visibleUserIds : new Set([identity.userId]);
const hasPeopleOps = poWs !== undefined;
if (poVisible !== null) {
  const leaked = (poCalls.calls ?? []).filter((c) => !hasInPolicyParty(c.parties, poVisible));
  check("People Ops: only in-policy calls visible", leaked.length === 0,
    `${poCalls.calls?.length ?? 0} visible (first page), ${leaked.length} unjustified${hasPeopleOps ? "" : " (no profile there → own calls only)"}`);
} else {
  console.log("  (profile grants unrestricted People Ops calls — nothing to hide)");
}

// ── 4. Stats scoping ──────────────────────────────────────────────────────────

console.log(`\n— Stats —`);
// Same own-data-only fallback as calls: `undefined !== null` must not crash us
const statsAccess = (policy.perWorkspace.get(CUSTOMERS) ?? policy.perWorkspace.get("*"))?.stats
  ?? { level: "none" as const, visibleUserIds: new Set([identity.userId]) };
if (statsAccess.visibleUserIds !== null) {
  const visible = statsAccess.visibleUserIds;
  // Stats endpoints take date-only values and reject anything past "today" in the
  // org's timezone. Slicing the UTC timestamp produced tomorrow's date during PT
  // evenings, so end the range at yesterday — valid in every timezone.
  const day = 86400_000;
  const dateRange = {
    fromDate: new Date(Date.now() - 14 * day).toISOString().slice(0, 10),
    toDate: new Date(Date.now() - day).toISOString().slice(0, 10),
  };
  const outside = visible.has(OUT_OF_POLICY_PROBE) ? null : OUT_OF_POLICY_PROBE;
  if (outside) {
    await expectDenied("stats: requesting an out-of-policy user's stats", () =>
      scoped.getActivityAggregate({ filter: { ...dateRange, userIds: [outside] } }));
  }
  try {
    const body = await scoped.getActivityAggregate({ filter: { ...dateRange } }) as any;
    const returnedUsers: string[] = (body?.usersAggregateActivityStats ?? []).map((u: any) => String(u.userId));
    const leakedStats = returnedUsers.filter((id) => !visible.has(id));
    check("stats: default query returns only visible users", leakedStats.length === 0,
      `${returnedUsers.length} users returned, ${leakedStats.length} outside policy`);
  } catch (err) {
    // Gong 404s when none of the (correctly scoped) userIds have stats data.
    // The policy did its job if every id Gong complains about is within the visible set.
    const msg = err instanceof Error ? err.message : String(err);
    const mentioned = msg.match(/\d{10,}/g) ?? [];
    const allInPolicy = mentioned.length > 0 && mentioned.every((id) => visible.has(id));
    check("stats: default query was scoped to visible users only", allInPolicy,
      allInPolicy
        ? `request contained only in-policy userIds; Gong has no stats data for them (${mentioned.length} ids)`
        : `unexpected error: ${msg.slice(0, 140)}`);
  }
} else {
  console.log("  (stats unrestricted for this profile)");
}

// ── 5. AI tools & admin surface ───────────────────────────────────────────────

console.log(`\n— AI + admin gates —`);
if (callsAccess.visibleUserIds !== null) {
  await expectDenied("AI: askAccount without org-wide call access", () =>
    scoped.askAccount({ workspaceId: CUSTOMERS, crmAccountId: "any", fromDateTime: range.fromDateTime, toDateTime: range.toDateTime, question: "test" }));
} else {
  console.log("  (calls=all → AI tools legitimately allowed; skipping deny check)");
}
if (!policy.capabilities.techAdmin) {
  await expectDenied("admin: audit logs without techAdmin", () => scoped.getLogs());
  await expectDenied("admin: data privacy lookup without techAdmin", () => scoped.getDataForEmail("x@y.com"));
  await expectDenied("admin: permission profiles without techAdmin", () => scoped.listAllPermissionProfiles());
} else {
  console.log("  (techAdmin=true → admin surface legitimately allowed)");
}
if (!policy.capabilities.crmWrite) {
  await expectDenied("CRM: write without crmWrite capability", () => scoped.upsertCrmEntities({}));
}

// ── Summary ───────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.pass);
console.log(`\n══ ${results.length - failed.length}/${results.length} checks passed ══`);
if (failed.length) {
  for (const f of failed) console.log(`   FAILED: ${f.name} — ${f.detail}`);
  process.exit(1);
}
