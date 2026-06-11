import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { PermissionResolver, PolicyResolutionError, degradedPolicy } = await import("./permissionResolver.js");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const WORKSPACES = fixture("workspaces.json") as Array<{ id: string; name: string }>;
const PROFILES: Record<string, any[]> = {
  "2163970312763144602": fixture("profiles.customers.json"),
  "815177878201176809": fixture("profiles.peopleops.json"),
};
const PROFILE_USERS = fixture("profileUsers.json") as Record<string, string[]>;
const MANAGER_GRAPH = fixture("managerGraph.json") as Array<{ id: string; managerId: string | null; active: boolean }>;

// Live-data personas — see docs/phase3a-discovery.md
const JEN = "2830045931589947630";      // Executive (Customers) + Standard Team Member (People Ops)
const CAIO = "60390778292225908";       // Delivery Team Member (Customers only)
const GARRETT = "6763988578246665360";  // Collaborator (Customers only)
const DELIVERY_LEADS = ["8319711599868458358", "8235508109267676138", "2701822690086447503"];
const CUSTOMERS = "2163970312763144602";
const PEOPLE_OPS = "815177878201176809";

let failNextSnapshot = false;
let apiCalls = 0;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  apiCalls++;
  if (failNextSnapshot) return new Response("boom", { status: 500 });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  const body = init?.body ? JSON.parse(init.body) : undefined;

  if (url.includes("/v2/workspaces")) return json({ workspaces: WORKSPACES });
  if (url.includes("/v2/all-permission-profiles")) {
    const wsId = new URL(url).searchParams.get("workspaceId")!;
    return json({ profiles: PROFILES[wsId] ?? [] });
  }
  if (url.includes("/v2/permission-profile/users")) {
    const profileId = new URL(url).searchParams.get("profileId")!;
    return json({ users: (PROFILE_USERS[profileId] ?? []).map((id) => ({ id })) });
  }
  if (url.includes("/v2/users/extensive")) {
    // The live API rejects a body without `filter` (observed 2026-06-11)
    if (!body || !("filter" in body)) {
      return new Response(JSON.stringify({ errors: ["Json parse error"] }), { status: 400 });
    }
    return json({ users: MANAGER_GRAPH, records: {} });
  }
  return json({ ok: true });
}) as typeof fetch;

/** Reference transitive-report expansion, independent of the implementation. */
function reportsOf(leads: string[], includeLeads: boolean): Set<string> {
  const children = new Map<string, string[]>();
  for (const u of MANAGER_GRAPH) {
    if (u.managerId && u.active) {
      children.set(u.managerId, [...(children.get(u.managerId) ?? []), u.id]);
    }
  }
  const out = new Set<string>();
  const seen = new Set<string>(leads);
  const stack = [...leads];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      out.add(c);
      if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  if (includeLeads) for (const lead of leads) out.add(lead);
  return out;
}

describe("PermissionResolver", () => {
  const resolver = new PermissionResolver(new GongClient());

  test("Executive resolves to unrestricted access in both workspaces", async () => {
    const policy = await resolver.resolvePolicy(JEN, "jen@gonimbly.com");
    assert.equal(policy.degraded, false);
    assert.deepEqual(policy.workspaceIds.sort(), [PEOPLE_OPS, CUSTOMERS].sort());
    const customers = policy.perWorkspace.get(CUSTOMERS)!;
    assert.equal(customers.profileName, "Executive");
    assert.equal(customers.calls.level, "all");
    assert.equal(customers.calls.visibleUserIds, null);
    assert.equal(customers.deals.visibleUserIds, null);
    assert.equal(policy.capabilities.techAdmin, true);
    assert.equal(policy.capabilities.crmWrite, true);
  });

  test("multi-workspace user gets distinct per-workspace policies", async () => {
    const policy = await resolver.resolvePolicy(JEN, "jen@gonimbly.com");
    // Standard Team Member in People Ops has usage none but insights all
    const peopleOps = policy.perWorkspace.get(PEOPLE_OPS)!;
    assert.equal(peopleOps.profileName, "Standard Team Member");
    assert.equal(peopleOps.stats.level, "all");
  });

  test("Delivery Team Member: managers-team calls expand to leads + transitive reports + self", async () => {
    const policy = await resolver.resolvePolicy(CAIO, "caio@gonimbly.com");
    const customers = policy.perWorkspace.get(CUSTOMERS)!;
    assert.equal(customers.profileName, "Delivery Team Member");
    assert.equal(customers.calls.level, "managers-team");
    const visible = customers.calls.visibleUserIds!;
    const profile = PROFILES[CUSTOMERS].find((p) => p.name === "Delivery Team Member")!;
    const expected = reportsOf(profile.callsAccess.teamLeadIds, true);
    expected.add(CAIO);
    assert.deepEqual([...visible].sort(), [...expected].sort());
    // spot checks: every lead is visible, and so is Caio himself
    for (const lead of profile.callsAccess.teamLeadIds) assert.ok(visible.has(lead));
    assert.ok(visible.has(CAIO));
  });

  test("report-to-them with null leads means the user's own transitive reports", async () => {
    const policy = await resolver.resolvePolicy(CAIO, "caio@gonimbly.com");
    const deals = policy.perWorkspace.get(CUSTOMERS)!.deals;
    assert.equal(deals.level, "report-to-them");
    // Caio has no reports in the manager graph → only people who report to him (none)
    assert.deepEqual([...deals.visibleUserIds!], []);
    // coaching adds self
    const coaching = policy.perWorkspace.get(CUSTOMERS)!.coaching;
    assert.deepEqual([...coaching.visibleUserIds!], [CAIO]);
  });

  test("Collaborator: report-to-them with explicit leads expands to the leads' reports, excluding the leads", async () => {
    const policy = await resolver.resolvePolicy(GARRETT, "garrett@gonimbly.com");
    const calls = policy.perWorkspace.get(CUSTOMERS)!.calls;
    assert.equal(calls.level, "report-to-them");
    const visible = calls.visibleUserIds!;
    const expected = reportsOf(DELIVERY_LEADS, false);
    expected.add(GARRETT); // self is always visible for calls
    assert.deepEqual([...visible].sort(), [...expected].sort());
    // TJ reports to no other delivery lead, so lead-exclusion removes him outright.
    // (Nikki stays visible — she is a lead AND a transitive report of TJ.)
    assert.ok(!visible.has("2701822690086447503"), "TJ is a lead, not anyone's report — must be excluded");
  });

  test("Collaborator: stats level none still keeps self visible (Phase 2 parity)", async () => {
    const policy = await resolver.resolvePolicy(GARRETT, "garrett@gonimbly.com");
    const stats = policy.perWorkspace.get(CUSTOMERS)!.stats;
    assert.equal(stats.level, "none");
    assert.deepEqual([...stats.visibleUserIds!], [GARRETT]);
    assert.equal(policy.capabilities.techAdmin, false);
    assert.equal(policy.capabilities.crmWrite, false);
    assert.equal(policy.capabilities.privateCalls, false);
  });

  test("Integration User: level none wins over vestigial teamLeadIds", async () => {
    const policy = await resolver.resolvePolicy("8571631700241553177", "dust@gonimbly.com");
    const calls = policy.perWorkspace.get(CUSTOMERS)!.calls;
    assert.equal(calls.level, "none");
    // only self — the 34 vestigial teamLeadIds must NOT be expanded
    assert.deepEqual([...calls.visibleUserIds!], ["8571631700241553177"]);
  });

  test("user in no profile anywhere fails resolution (caller degrades)", async () => {
    await assert.rejects(resolver.resolvePolicy("0000", "ghost@gonimbly.com"), PolicyResolutionError);
  });

  test("snapshot is cached: repeated resolutions don't refetch", async () => {
    const fresh = new PermissionResolver(new GongClient());
    await fresh.resolvePolicy(JEN, "jen@gonimbly.com");
    const after = apiCalls;
    await fresh.resolvePolicy(CAIO, "caio@gonimbly.com");
    await fresh.resolvePolicy(GARRETT, "garrett@gonimbly.com");
    assert.equal(apiCalls, after, "no extra API calls after the snapshot is built");
  });

  test("refresh failure serves a stale snapshot within the cap, then fails closed past it", async () => {
    const fresh = new PermissionResolver(new GongClient(), { ttlMs: 0, maxStaleMs: 60_000 });
    const policy = await fresh.resolvePolicy(JEN, "jen@gonimbly.com");
    assert.equal(policy.degraded, false);
    failNextSnapshot = true;
    try {
      // ttl 0 forces refresh; refresh fails; snapshot is fresh enough → stale serve
      const stale = await fresh.resolvePolicy(CAIO, "caio@gonimbly.com");
      assert.equal(stale.perWorkspace.get(CUSTOMERS)!.profileName, "Delivery Team Member");
      // past the stale cap → fail closed
      const expired = new PermissionResolver(new GongClient(), { ttlMs: 0, maxStaleMs: 0 });
      await assert.rejects(expired.resolvePolicy(JEN, "jen@gonimbly.com"), PolicyResolutionError);
    } finally {
      failNextSnapshot = false;
    }
  });
});

describe("degradedPolicy", () => {
  test("matches the Phase 2 member policy: self-only data, no writes", () => {
    const policy = degradedPolicy("222", "member@gonimbly.com");
    assert.equal(policy.degraded, true);
    const ws = policy.perWorkspace.get("*")!;
    assert.deepEqual([...ws.calls.visibleUserIds!], ["222"]);
    assert.deepEqual([...ws.stats.visibleUserIds!], ["222"]);
    assert.equal(ws.library.level, "all");
    assert.equal(policy.capabilities.techAdmin, false);
    assert.equal(policy.capabilities.crmWrite, false);
    assert.equal(policy.capabilities.scheduleCalls, false);
  });
});
