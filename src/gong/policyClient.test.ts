import { describe, test, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { PolicyGongClient } = await import("./policyClient.js");
const { AccessDeniedError } = await import("./scopedClient.js");
const { degradedPolicy } = await import("./permissionResolver.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;
type WorkspacePolicy = import("./permissionResolver.js").WorkspacePolicy;

const WS1 = "ws-customers";
const WS2 = "ws-peopleops";
const SELF = { userId: "222", email: "member@gonimbly.com", fullName: "Member User" };

function ws(workspaceId: string, over: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    workspaceId,
    profileId: "p1",
    profileName: "Test Profile",
    calls: { level: "all", visibleUserIds: null },
    deals: { level: "all", visibleUserIds: null },
    coaching: { level: "all", visibleUserIds: null },
    stats: { level: "all", visibleUserIds: null },
    library: { level: "all", folderIds: null },
    ...over,
  };
}

function policy(workspaces: WorkspacePolicy[], caps: Partial<UserPolicy["capabilities"]> = {}): UserPolicy {
  return {
    userId: SELF.userId,
    email: SELF.email,
    workspaceIds: workspaces.map((w) => w.workspaceId),
    perWorkspace: new Map(workspaces.map((w) => [w.workspaceId, w])),
    capabilities: {
      downloadCallMedia: false,
      privateCalls: false,
      manageScorecards: false,
      crmWrite: false,
      techAdmin: false,
      scheduleCalls: false,
      ...caps,
    },
    degraded: false,
  };
}

// Personas
const EXEC = policy([ws(WS1)], { crmWrite: true, techAdmin: true, scheduleCalls: true });
const MANAGER = policy(
  [ws(WS1, {
    calls: { level: "managers-team", visibleUserIds: new Set(["222", "300", "301"]) },
    stats: { level: "report-to-them", visibleUserIds: new Set(["222", "300", "301"]) },
    coaching: { level: "report-to-them", visibleUserIds: new Set(["222", "300"]) },
  })],
  { scheduleCalls: true }
);
const RESTRICTED = policy([
  ws(WS1, {
    calls: { level: "none", visibleUserIds: new Set(["222"]) },
    deals: { level: "none", visibleUserIds: new Set() },
    coaching: { level: "none", visibleUserIds: new Set(["222"]) },
    stats: { level: "none", visibleUserIds: new Set(["222"]) },
    library: { level: "none", folderIds: null },
  }),
]);
const FOLDER_SCOPED = policy([
  ws(WS1, { library: { level: "selected", folderIds: new Set(["f-1"]) } }),
]);
// All calls in WS1, own calls only in WS2 — the multi-workspace fidelity case
const SPLIT = policy([
  ws(WS1),
  ws(WS2, { calls: { level: "none", visibleUserIds: new Set(["222"]) } }),
]);

// Calls: 1001 has party 300 (manager's report) in WS1; 1002 has party 999 in WS1;
// 2001 has party 999 in WS2.
const EXTENSIVE_CALLS = [
  { metaData: { id: "1001", workspaceId: WS1 }, parties: [{ userId: "300" }] },
  { metaData: { id: "1002", workspaceId: WS1 }, parties: [{ userId: "999" }] },
  { metaData: { id: "2001", workspaceId: WS2 }, parties: [{ userId: "999" }] },
];

interface CapturedRequest {
  url: string;
  method: string;
  body?: any;
}

let requests: CapturedRequest[] = [];

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body });

  if (url.includes("/v2/calls/extensive")) {
    const callIds: string[] | undefined = body?.filter?.callIds;
    const wsId: string | undefined = body?.filter?.workspaceId;
    let calls = EXTENSIVE_CALLS;
    if (callIds) calls = calls.filter((c) => callIds.includes(c.metaData.id));
    if (wsId) calls = calls.filter((c) => c.metaData.workspaceId === wsId);
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
  return json({ ok: true, echo: { url, filter: body?.filter } });
}) as typeof fetch;

const exec = new PolicyGongClient(SELF, EXEC);
const manager = new PolicyGongClient(SELF, MANAGER);
const restricted = new PolicyGongClient(SELF, RESTRICTED);
const split = new PolicyGongClient(SELF, SPLIT);
const degraded = new PolicyGongClient(SELF, degradedPolicy(SELF.userId, SELF.email));

beforeEach(() => {
  requests = [];
});

describe("calls visibility", () => {
  test("unrestricted profile lists calls through the basic endpoint", async () => {
    const result = await exec.listCalls({}) as { calls: any[] };
    assert.equal(result.calls.length, 3);
    assert.equal(requests[0].method, "GET");
    assert.ok(!requests[0].url.includes("extensive"));
  });

  test("team-scoped profile only sees calls with a visible party", async () => {
    const result = await manager.listCalls({}) as { calls: any[] };
    assert.deepEqual(result.calls.map((c) => c.metaData.id), ["1001"]);
    assert.equal(requests[0].body.contentSelector.exposedFields.parties, true);
  });

  test("getCall denies calls outside the visible set", async () => {
    await assert.rejects(manager.getCall("1002"), AccessDeniedError);
    await manager.getCall("1001");
  });

  test("transcripts: any non-visible id denies the whole request, naming the ids", async () => {
    await assert.rejects(manager.getCallTranscripts(["1001", "1002"]), (err: Error) => {
      assert.ok(err instanceof AccessDeniedError);
      assert.ok(err.message.includes("1002"));
      return true;
    });
    assert.ok(!requests.some((r) => r.url.includes("/transcript")));
    await manager.getCallTranscripts(["1001"]);
  });

  test("multi-workspace: each call is filtered by its own workspace policy", async () => {
    // SPLIT sees everything in WS1, only their own calls in WS2:
    // 1002 (stranger, WS1) visible; 2001 (stranger, WS2) hidden.
    const result = await split.getExtensiveCalls({ filter: {} }) as { calls: any[] };
    assert.deepEqual(result.calls.map((c) => c.metaData.id).sort(), ["1001", "1002"]);
  });

  test("workspace-scoped query uses that workspace's policy alone", async () => {
    const inWs1 = await split.getExtensiveCalls({ filter: { workspaceId: WS1 } }) as { calls: any[] };
    assert.ok(!("note" in inWs1), "unrestricted in WS1 → passthrough");
    const inWs2 = await split.getExtensiveCalls({ filter: { workspaceId: WS2 } }) as { calls: any[] };
    assert.deepEqual(inWs2.calls, [], "stranger calls in WS2 are hidden");
  });

  test("call writes gate on the scheduleCalls capability", async () => {
    await assert.rejects(async () => restricted.createCall({}), AccessDeniedError);
    await manager.createCall({});
    assert.equal(requests.length, 1);
  });
});

describe("stats scoping", () => {
  test("unrestricted stats pass through untouched", async () => {
    await exec.getActivityAggregate({ filter: { userIds: ["111"] } });
    assert.deepEqual(requests[0].body.filter.userIds, ["111"]);
  });

  test("requested userIds are intersected with the visible set", async () => {
    await manager.getInteractionStats({ filter: { userIds: ["300", "999"] } });
    assert.deepEqual(requests[0].body.filter.userIds, ["300"]);
  });

  test("no requested userIds defaults to the full visible team", async () => {
    await manager.getActivityAggregate({ filter: {} });
    assert.deepEqual(requests[0].body.filter.userIds.sort(), ["222", "300", "301"]);
  });

  test("empty intersection denies instead of leaking", async () => {
    await assert.rejects(async () => manager.getScorecardStats({ filter: { userIds: ["999"] } }), AccessDeniedError);
    assert.equal(requests.length, 0);
  });

  test("'none' insights still allow self-stats (Phase 2 parity)", async () => {
    await restricted.getActivityDayByDay({ filter: {} });
    assert.deepEqual(requests[0].body.filter.userIds, ["222"]);
  });

  test("coaching: visible manager allowed, stranger denied, default self", async () => {
    const range = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    await manager.getCoaching({ workspaceId: WS1, managerId: "300", ...range });
    assert.ok(requests[0].url.includes("manager-id=300"));
    assert.ok(requests[0].url.includes("workspace-id=ws-customers"));
    await assert.rejects(async () => manager.getCoaching({ workspaceId: WS1, managerId: "999", ...range }), AccessDeniedError);
    requests = [];
    await manager.getCoaching({ workspaceId: WS1, ...range });
    assert.ok(requests[0].url.includes("manager-id=222"), "omitted managerId defaults to self");
  });
});

describe("AI synthesis requires unrestricted call access in the workspace", () => {
  const aiParams = { workspaceId: WS1, crmAccountId: "a", crmDealId: "d", timePeriod: "THIS_MONTH", question: "q" };

  // These tests exercise the policy gate for the AI tools, not the credit kill
  // switch — opt past the GongClient credit guard so granted calls reach the mock.
  before(() => { process.env.GONG_ENABLE_AI_ENTITIES = "true"; });
  after(() => { delete process.env.GONG_ENABLE_AI_ENTITIES; });

  test("granted for an all-calls profile", async () => {
    await exec.askAccount(aiParams);
    await exec.askDeal(aiParams);
    assert.equal(requests.length, 2);
  });

  test("denied for team-scoped call access", async () => {
    await assert.rejects(async () => manager.askAccount(aiParams), AccessDeniedError);
    await assert.rejects(async () => manager.askDeal(aiParams), AccessDeniedError);
    await assert.rejects(
      async () => manager.generateBrief({ workspaceId: WS1, briefName: "b", crmEntityType: "ACCOUNT", crmEntityId: "e", timePeriod: "THIS_MONTH" }),
      AccessDeniedError
    );
    assert.equal(requests.length, 0);
  });

  test("multi-workspace: granted only in the all-calls workspace", async () => {
    await split.askAccount({ ...aiParams, workspaceId: WS1 });
    await assert.rejects(async () => split.askAccount({ ...aiParams, workspaceId: WS2 }), AccessDeniedError);
    assert.equal(requests.length, 1);
  });
});

describe("library gating", () => {
  test("'none' access denies library tools", async () => {
    await assert.rejects(async () => restricted.listLibraryFolders(), AccessDeniedError);
    await assert.rejects(async () => restricted.getLibraryFolderContent("f-1"), AccessDeniedError);
    assert.equal(requests.length, 0);
  });

  test("folder allowlist restricts content access", async () => {
    const client = new PolicyGongClient(SELF, FOLDER_SCOPED);
    await client.getLibraryFolderContent("f-1");
    await assert.rejects(async () => client.getLibraryFolderContent("f-2"), AccessDeniedError);
    assert.equal(requests.length, 1);
  });
});

describe("CRM, deals and the admin surface", () => {
  test("deals 'none' blocks CRM reads", async () => {
    await assert.rejects(async () => restricted.getCrmEntities({ crmObjectType: "Deal" }), AccessDeniedError);
    await manager.getCrmEntities({ crmObjectType: "Deal" });
    assert.equal(requests.length, 1);
  });

  test("CRM writes need the crmWrite capability, not just deals access", async () => {
    await assert.rejects(async () => manager.upsertCrmEntities({}), AccessDeniedError);
    await exec.upsertCrmEntities({});
    assert.equal(requests.length, 1);
  });

  test("admin surface gates on techAdmin", async () => {
    const deniedOps: Array<() => unknown> = [
      () => manager.getLogs(),
      () => manager.getDataForEmail("x@y.com"),
      () => manager.eraseDataForEmail("x@y.com"),
      () => manager.listAllPermissionProfiles(),
      () => manager.getCrmIntegrations(),
      () => manager.addCallUsersAccess({}),
      () => manager.getExtensiveUsers({}),
      () => manager.getUserSettingsHistory("1"),
      () => manager.updateIntegrationSettings({}),
      () => manager.bulkAssignFlows({}),
      () => manager.createTask({}),
    ];
    for (const op of deniedOps) {
      await assert.rejects(async () => op(), AccessDeniedError);
    }
    assert.equal(requests.length, 0);
    await exec.getLogs({ logType: "UserActivityLog" });
    await exec.listAllPermissionProfiles();
    assert.equal(requests.length, 2);
  });

  test("meetings gate on scheduleCalls", async () => {
    await assert.rejects(async () => restricted.createMeeting({}), AccessDeniedError);
    await manager.createMeeting({});
    assert.equal(requests.length, 1);
  });
});

describe("degraded (fail-closed) policy behaves like a Phase 2 member", () => {
  test("calls are participant-checked", async () => {
    const result = await degraded.listCalls({}) as { calls: any[] };
    assert.deepEqual(result.calls, [], "no call has the user as a party");
  });

  test("stats for other users are denied", async () => {
    await assert.rejects(async () => degraded.getActivityAggregate({ filter: { userIds: ["999"] } }), AccessDeniedError);
    assert.equal(requests.length, 0, "stranger-only request is denied before any API call");
  });

  test("stats default to self", async () => {
    await degraded.getActivityAggregate({ filter: {} });
    assert.deepEqual(requests[0].body.filter.userIds, ["222"]);
  });

  test("all writes and admin tools are denied", async () => {
    await assert.rejects(async () => degraded.createCall({}), AccessDeniedError);
    await assert.rejects(async () => degraded.upsertCrmEntities({}), AccessDeniedError);
    await assert.rejects(async () => degraded.getLogs(), AccessDeniedError);
    await assert.rejects(async () => degraded.askAccount({ workspaceId: WS1, crmAccountId: "a", fromDateTime: "f", toDateTime: "t", question: "q" }), AccessDeniedError);
    assert.equal(requests.length, 0);
  });
});
