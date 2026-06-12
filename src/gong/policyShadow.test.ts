import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { ScopedGongClient, AccessDeniedError } = await import("./scopedClient.js");
const { shadowGongClient } = await import("./policyShadow.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;

const SELF = { userId: "222", email: "member@gonimbly.com" };

function makePolicy(caps: Partial<UserPolicy["capabilities"]>, callsVisible: Set<string> | null): UserPolicy {
  return {
    userId: SELF.userId,
    email: SELF.email,
    workspaceIds: ["ws1"],
    perWorkspace: new Map([["ws1", {
      workspaceId: "ws1",
      profileId: "p1",
      profileName: "Shadow Test",
      calls: { level: callsVisible ? "managers-team" : "all", visibleUserIds: callsVisible },
      deals: { level: "all", visibleUserIds: null },
      coaching: { level: "report-to-them", visibleUserIds: new Set([SELF.userId]) },
      stats: { level: "report-to-them", visibleUserIds: new Set([SELF.userId, "300"]) },
      library: { level: "all", folderIds: null },
    }]]),
    capabilities: {
      downloadCallMedia: false, privateCalls: false, manageScorecards: false,
      crmWrite: false, techAdmin: true, scheduleCalls: false,
      ...caps,
    },
    degraded: false,
  };
}

let requests = 0;
let logs: string[] = [];

globalThis.fetch = (async () => {
  requests++;
  return new Response(JSON.stringify({ ok: true, calls: [], records: {} }), { status: 200 });
}) as typeof fetch;

const originalError = console.error;

beforeEach(() => {
  requests = 0;
  logs = [];
  console.error = (...args: unknown[]) => { logs.push(args.join(" ")); };
});

// restore for any output after tests
process.on("exit", () => { console.error = originalError; });

describe("shadow mode", () => {
  test("binary enforcement is unchanged: member still denied, diff logged", async () => {
    const binary = new ScopedGongClient(SELF, "member");
    const shadow = shadowGongClient(binary, SELF, "member", makePolicy({ techAdmin: true }, null));
    // Binary denies audit logs to members; the profile (techAdmin) would allow → diff
    assert.throws(() => (shadow as any).getLogs(), AccessDeniedError);
    assert.equal(requests, 0);
    assert.ok(logs.some((l) => l.includes("SHADOW diff getLogs") && l.includes("binary=deny profiles=allow")), logs.join("\n"));
  });

  test("agreeing decisions produce no diff log", async () => {
    const binary = new ScopedGongClient(SELF, "member");
    const shadow = shadowGongClient(binary, SELF, "member", makePolicy({ techAdmin: false }, null));
    assert.throws(() => (shadow as any).getLogs(), AccessDeniedError);
    assert.ok(!logs.some((l) => l.includes("SHADOW diff getLogs")), logs.join("\n"));
  });

  test("stats scope difference is logged but binary self-scoping still applies", async () => {
    const binary = new ScopedGongClient(SELF, "member");
    const shadow = shadowGongClient(binary, SELF, "member", makePolicy({}, new Set(["222", "300"])));
    await (shadow as any).getActivityAggregate({ filter: {} });
    assert.equal(requests, 1, "the underlying binary client still issues the request");
    assert.ok(logs.some((l) => l.includes("SHADOW diff getActivityAggregate") && l.includes("2 visible users")), logs.join("\n"));
  });

  test("call visibility difference is logged for broader-than-self profiles", async () => {
    const binary = new ScopedGongClient(SELF, "member");
    const shadow = shadowGongClient(binary, SELF, "member", makePolicy({}, null));
    await (shadow as any).listCalls({});
    assert.ok(logs.some((l) => l.includes("SHADOW diff listCalls") && l.includes("profiles=unrestricted")), logs.join("\n"));
  });

  test("no policy resolved → plain binary client, no shadow logging", async () => {
    const binary = new ScopedGongClient(SELF, "member");
    const shadow = shadowGongClient(binary, SELF, "member", null);
    assert.equal(shadow, binary);
  });
});
