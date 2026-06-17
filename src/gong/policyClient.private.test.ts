import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { PolicyGongClient } = await import("./policyClient.js");
const { AccessDeniedError } = await import("./scopedClient.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;
type WorkspacePolicy = import("./permissionResolver.js").WorkspacePolicy;

const WS = "ws1";
const SELF = { userId: "222", email: "me@gonimbly.com" };

function ws(over: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    workspaceId: WS, profileId: "p", profileName: "Test",
    calls: { level: "all", visibleUserIds: null },
    deals: { level: "all", visibleUserIds: null },
    coaching: { level: "all", visibleUserIds: null },
    stats: { level: "all", visibleUserIds: null },
    library: { level: "all", folderIds: null },
    ...over,
  };
}
function policy(w: WorkspacePolicy, caps: Partial<UserPolicy["capabilities"]> = {}): UserPolicy {
  return {
    userId: SELF.userId, email: SELF.email, workspaceIds: [w.workspaceId],
    perWorkspace: new Map([[w.workspaceId, w]]),
    capabilities: { downloadCallMedia: false, privateCalls: true, manageScorecards: false, crmWrite: false, techAdmin: false, scheduleCalls: false, ...caps },
    degraded: false,
  };
}

// n1 = normal (owner 300). po = PRIVATE owned by SELF(222). px = PRIVATE owned by 300.
const CALLS = [
  { metaData: { id: "n1", workspaceId: WS, isPrivate: false, primaryUserId: "300" }, parties: [{ userId: "300" }] },
  { metaData: { id: "po", workspaceId: WS, isPrivate: true, primaryUserId: "222" }, parties: [{ userId: "222" }, { userId: "999" }] },
  { metaData: { id: "px", workspaceId: WS, isPrivate: true, primaryUserId: "300" }, parties: [{ userId: "300" }, { userId: "999" }] },
];

let requests: any[] = [];
const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ url });
  if (url.includes("/v2/calls/extensive")) {
    const ids: string[] | undefined = body?.filter?.callIds;
    const calls = ids ? CALLS.filter((c) => ids.includes(c.metaData.id)) : CALLS;
    return json({ calls, records: {} });
  }
  if (url.includes("/v2/calls/transcript")) return json({ callTranscripts: body.filter.callIds.map((id: string) => ({ callId: id })) });
  if (/\/v2\/calls\/\w+$/.test(url)) return json({ call: { id: url.split("/").pop() } });
  if (url.includes("/v2/calls")) return json({ calls: CALLS.map((c) => c.metaData), records: {} }); // basic: top-level isPrivate/primaryUserId
  return json({ ok: true });
}) as typeof fetch;

// Manager: managers-team, visible set includes 300 (the owner of the private px call).
const manager = new PolicyGongClient(SELF, policy(ws({ calls: { level: "managers-team", visibleUserIds: new Set(["222", "300", "301"]) } })));
// Exec: all-access. Even so, must not see px (owner-only). privateCalls cap = true (irrelevant — owner-only).
const exec = new PolicyGongClient(SELF, policy(ws()));

beforeEach(() => { requests = []; });

describe("private calls are owner-only (restricted manager)", () => {
  test("getExtensiveCalls hides a report's private call, keeps own + normal", async () => {
    const r = await manager.getExtensiveCalls({ filter: {} }) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.metaData.id).sort(), ["n1", "po"], "px (private, owned by report 300) is hidden");
  });
  test("getCall denies a report's private call", async () => {
    await assert.rejects(manager.getCall("px"), AccessDeniedError);
  });
  test("getCall allows the manager's OWN private call", async () => {
    await manager.getCall("po");
  });
  test("transcripts of a report's private call are denied (id named)", async () => {
    await assert.rejects(manager.getCallTranscripts(["po", "px"]), (e: Error) => {
      assert.ok(e instanceof AccessDeniedError); assert.ok(e.message.includes("px")); return true;
    });
    assert.ok(!requests.some((r) => r.url.includes("/transcript")));
    await manager.getCallTranscripts(["po"]);
  });
});

describe("private calls are owner-only — beats all-access", () => {
  test("getExtensiveCalls hides others' private call from an all-access user", async () => {
    const r = await exec.getExtensiveCalls({ filter: {} }) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.metaData.id).sort(), ["n1", "po"], "px hidden despite callsAccess=all + privateCalls cap");
  });
  test("listCalls (basic endpoint) also drops others' private call", async () => {
    const r = await exec.listCalls({}) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.id).sort(), ["n1", "po"]);
    assert.ok(!requests[0].url.includes("extensive"), "still uses the basic endpoint");
  });
  test("getCall denies others' private call even for all-access", async () => {
    await assert.rejects(exec.getCall("px"), AccessDeniedError);
    await exec.getCall("po"); // own private — allowed
    await exec.getCall("n1"); // normal — allowed
  });
});
