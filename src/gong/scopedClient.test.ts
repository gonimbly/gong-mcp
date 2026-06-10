import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Org credential via env so the client never touches the keychain in tests
process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { ScopedGongClient, AccessDeniedError } = await import("./scopedClient.js");

const MEMBER_IDENTITY = { userId: "222", email: "member@gonimbly.com", fullName: "Member User" };

// Call 1001: member is a party (by userId). Call 1003: member is a party (by email only).
// Call 1002: someone else's call.
const EXTENSIVE_CALLS = [
  { metaData: { id: "1001", title: "Member <> Acme" }, parties: [{ userId: "222" }, { emailAddress: "buyer@acme.com" }] },
  { metaData: { id: "1002", title: "Private leadership sync" }, parties: [{ userId: "999" }] },
  { metaData: { id: "1003", title: "Member by email" }, parties: [{ emailAddress: "MEMBER@gonimbly.com" }] },
];

interface CapturedRequest {
  url: string;
  method: string;
  body?: any;
}

let requests: CapturedRequest[] = [];

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}

// In-process fake Gong API
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body });

  if (url.includes("/v2/calls/extensive")) {
    const callIds: string[] | undefined = body?.filter?.callIds;
    const calls = callIds ? EXTENSIVE_CALLS.filter((c) => callIds.includes(c.metaData.id)) : EXTENSIVE_CALLS;
    return json({ calls, records: {} });
  }
  if (url.includes("/v2/calls/transcript")) {
    return json({ callTranscripts: body.filter.callIds.map((id: string) => ({ callId: id })) });
  }
  if (/\/v2\/calls\/\d+$/.test(url)) {
    return json({ call: { id: url.split("/").pop() } });
  }
  if (url.includes("/v2/calls")) {
    return json({ calls: EXTENSIVE_CALLS.map((c) => c.metaData), records: {} });
  }
  if (url.includes("/v2/stats/") || url.includes("/v2/coaching")) {
    return json({ echo: { url, filter: body?.filter } });
  }
  return json({ ok: true });
}) as typeof fetch;

const member = new ScopedGongClient(MEMBER_IDENTITY, "member");
const admin = new ScopedGongClient(MEMBER_IDENTITY, "admin");

beforeEach(() => {
  requests = [];
});

describe("participant-checked calls", () => {
  test("member listCalls only returns calls they participated in", async () => {
    const result = await member.listCalls({}) as { calls: any[] };
    const ids = result.calls.map((c) => c.metaData.id);
    assert.deepEqual(ids.sort(), ["1001", "1003"]); // 1003 matched by email, case-insensitive
    assert.ok(requests[0].url.includes("/v2/calls/extensive"), "member listing must route through extensive for parties");
    assert.equal(requests[0].body.contentSelector.exposedFields.parties, true);
  });

  test("admin listCalls passes through to the basic endpoint unfiltered", async () => {
    const result = await admin.listCalls({}) as { calls: any[] };
    assert.equal(result.calls.length, 3);
    assert.equal(requests[0].method, "GET");
    assert.ok(!requests[0].url.includes("extensive"));
  });

  test("member getCall is denied for a call they were not on", async () => {
    await assert.rejects(member.getCall("1002"), AccessDeniedError);
  });

  test("member getCall succeeds for their own call", async () => {
    const result = await member.getCall("1001") as { call: { id: string } };
    assert.equal(result.call.id, "1001");
  });

  test("member transcripts are denied if ANY requested call is not theirs, naming the denied ids", async () => {
    await assert.rejects(member.getCallTranscripts(["1001", "1002"]), (err: Error) => {
      assert.ok(err instanceof AccessDeniedError);
      assert.ok(err.message.includes("1002"));
      assert.ok(!err.message.includes("1001,"));
      return true;
    });
    // The transcript endpoint must never have been called
    assert.ok(!requests.some((r) => r.url.includes("/transcript")));
  });

  test("member transcripts succeed for their own calls only", async () => {
    await member.getCallTranscripts(["1001", "1003"]);
    const transcriptReq = requests.find((r) => r.url.includes("/transcript"));
    assert.ok(transcriptReq);
    assert.deepEqual(transcriptReq.body.filter.callIds, ["1001", "1003"]);
  });

  test("member getExtensiveCalls forces parties exposure and filters results", async () => {
    const result = await member.getExtensiveCalls({
      filter: {},
      contentSelector: { exposedFields: { topics: true } },
    }) as { calls: any[] };
    assert.equal(requests[0].body.contentSelector.exposedFields.parties, true, "parties must be forced on");
    assert.equal(requests[0].body.contentSelector.exposedFields.topics, true, "caller's selector must be preserved");
    assert.deepEqual(result.calls.map((c) => c.metaData.id).sort(), ["1001", "1003"]);
  });
});

describe("self-scoped stats", () => {
  test("member-supplied userIds are overridden with their own", async () => {
    await member.getActivityAggregate({ filter: { userIds: ["111"], fromDateTime: "2026-01-01" } });
    assert.deepEqual(requests[0].body.filter.userIds, ["222"]);
    assert.equal(requests[0].body.filter.fromDateTime, "2026-01-01", "other filter fields preserved");
  });

  test("admin-supplied userIds pass through untouched", async () => {
    await admin.getActivityAggregate({ filter: { userIds: ["111"] } });
    assert.deepEqual(requests[0].body.filter.userIds, ["111"]);
  });

  test("all stats variants are scoped for members", async () => {
    await member.getActivityAggregateByPeriod({ filter: {} });
    await member.getActivityDayByDay({ filter: {} });
    await member.getScorecardStats({ filter: {} });
    await member.getInteractionStats({ filter: {} });
    for (const r of requests) {
      assert.deepEqual(r.body.filter.userIds, ["222"], `${r.url} must be self-scoped`);
    }
  });

  test("member coaching is forced to their own userId", async () => {
    await member.getCoaching({ userId: "111" });
    assert.ok(requests[0].url.includes("userId=222"));
    assert.ok(!requests[0].url.includes("userId=111"));
  });
});

describe("admin-only tools", () => {
  const denied: Array<[string, () => unknown]> = [
    ["audit logs", () => member.getLogs()],
    ["AI ask account", () => member.askAccount({ workspaceId: "w", crmAccountId: "a", fromDateTime: "f", toDateTime: "t", question: "q" })],
    ["AI ask deal", () => member.askDeal({ workspaceId: "w", crmDealId: "d", fromDateTime: "f", toDateTime: "t", question: "q" })],
    ["AI brief", () => member.generateBrief({ workspaceId: "w", briefName: "b", entityType: "ACCOUNT", crmEntityId: "e", periodType: "p", fromDateTime: "f", toDateTime: "t" })],
    ["data privacy read", () => member.getDataForEmail("x@y.com")],
    ["data erasure", () => member.eraseDataForEmail("x@y.com")],
    ["permission profiles", () => member.listAllPermissionProfiles()],
    ["call access management", () => member.addCallUsersAccess({})],
    ["CRM writes", () => member.upsertCrmEntities({})],
    ["CRM integration management", () => member.getCrmIntegrations()],
    ["meeting creation", () => member.createMeeting({})],
    ["flow writes", () => member.bulkAssignFlows({})],
    ["call creation", () => member.createCall({})],
    ["task writes", () => member.createTask({})],
    ["extensive users", () => member.getExtensiveUsers({})],
    ["user settings history", () => member.getUserSettingsHistory("1")],
  ];

  for (const [name, fn] of denied) {
    test(`member is denied: ${name}`, () => {
      assert.throws(fn, AccessDeniedError);
      assert.equal(requests.length, 0, "no request must reach Gong");
    });
  }

  test("admin passes through on admin-only tools", async () => {
    await admin.getLogs();
    await admin.getDataForEmail("x@y.com");
    await admin.listAllPermissionProfiles();
    assert.equal(requests.length, 3);
  });
});

describe("open tools", () => {
  test("members can use harmless metadata tools", async () => {
    await member.listWorkspaces();
    await member.listUsers();
    await member.listScorecards();
    await member.listTrackers();
    await member.listLibraryFolders();
    await member.listFlows();
    assert.equal(requests.length, 6);
  });
});
