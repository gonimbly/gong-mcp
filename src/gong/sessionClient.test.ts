import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { parsePolicyMode, buildSessionClient } = await import("./sessionClient.js");
const { ScopedGongClient, AccessDeniedError } = await import("./scopedClient.js");
const { PolicyGongClient } = await import("./policyClient.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;
type PolicyResolver = import("./sessionClient.js").PolicyResolver;

const SELF = { userId: "222", email: "member@gonimbly.com" };

function makePolicy(profileNames: string[], caps: Partial<UserPolicy["capabilities"]> = {}): UserPolicy {
  const perWorkspace = new Map(profileNames.map((profileName, i) => [`ws${i + 1}`, {
    workspaceId: `ws${i + 1}`,
    profileId: `p${i + 1}`,
    profileName,
    calls: { level: "all" as const, visibleUserIds: null },
    deals: { level: "all" as const, visibleUserIds: null },
    coaching: { level: "report-to-them" as const, visibleUserIds: new Set([SELF.userId]) },
    stats: { level: "report-to-them" as const, visibleUserIds: new Set([SELF.userId]) },
    library: { level: "all" as const, folderIds: null },
  }]));
  return {
    userId: SELF.userId,
    email: SELF.email,
    workspaceIds: [...perWorkspace.keys()],
    perWorkspace,
    capabilities: {
      downloadCallMedia: false, privateCalls: false, manageScorecards: false,
      crmWrite: false, techAdmin: false, scheduleCalls: false,
      ...caps,
    },
    degraded: false,
  };
}

function stubResolver(policy: UserPolicy): PolicyResolver & { calls: number } {
  return {
    calls: 0,
    async resolvePolicy() { this.calls++; return policy; },
  };
}

const failingResolver: PolicyResolver = {
  async resolvePolicy() { throw new Error("profile API down"); },
};

let logs: string[] = [];
const originalError = console.error;

globalThis.fetch = (async () => {
  return new Response(JSON.stringify({ ok: true, calls: [], records: {} }), { status: 200 });
}) as typeof fetch;

beforeEach(() => {
  logs = [];
  console.error = (...args: unknown[]) => { logs.push(args.join(" ")); };
});

process.on("exit", () => { console.error = originalError; });

describe("parsePolicyMode", () => {
  test("unset defaults to profiles", () => {
    assert.equal(parsePolicyMode(undefined), "profiles");
  });

  test("empty string defaults to profiles, not a boot failure", () => {
    // pins the `||` not `??` choice: a dashboard var saved as "" must mean the default
    assert.equal(parsePolicyMode(""), "profiles");
  });

  test("valid values pass through", () => {
    assert.equal(parsePolicyMode("binary"), "binary");
    assert.equal(parsePolicyMode("shadow"), "shadow");
    assert.equal(parsePolicyMode("profiles"), "profiles");
  });

  test("invalid value throws with the expected modes", () => {
    assert.throws(() => parsePolicyMode("on"), /Invalid GONG_POLICY_MODE "on".*binary \| shadow \| profiles/);
  });
});

describe("buildSessionClient", () => {
  test("binary mode never consults the resolver", async () => {
    const resolver = stubResolver(makePolicy(["Should Not Be Used"]));
    const member = await buildSessionClient(SELF, "member", "binary", resolver);
    assert.ok(member.client instanceof ScopedGongClient);
    assert.ok(!(member.client instanceof PolicyGongClient));
    assert.equal(member.access, "member — calls and stats are limited to your own activity");

    const admin = await buildSessionClient(SELF, "admin", "binary", resolver);
    assert.equal(admin.access, "admin (org-wide data)");
    assert.equal(resolver.calls, 0);
  });

  test("profiles mode: break-glass admin bypasses the resolver", async () => {
    const resolver = stubResolver(makePolicy(["Should Not Be Used"]));
    const { client, access } = await buildSessionClient(SELF, "admin", "profiles", resolver);
    assert.ok(client instanceof ScopedGongClient);
    assert.ok(!(client instanceof PolicyGongClient));
    assert.equal(access, "admin (org-wide data)");
    assert.equal(resolver.calls, 0);
  });

  test("profiles mode: member gets a PolicyGongClient naming their profiles", async () => {
    const resolver = stubResolver(makePolicy(["Executive", "Standard Team Member"]));
    const { client, access } = await buildSessionClient(SELF, "member", "profiles", resolver);
    assert.ok(client instanceof PolicyGongClient);
    assert.equal(access, "mirrors your Gong permission profile (Executive; Standard Team Member)");
    assert.equal(resolver.calls, 1);
  });

  test("profiles mode: resolver failure fails closed to the degraded policy", async () => {
    const { client, access } = await buildSessionClient(SELF, "member", "profiles", failingResolver);
    assert.ok(client instanceof PolicyGongClient);
    assert.equal(access, "member (fallback) — your Gong permission profile could not be resolved, so access is limited to your own activity");
    assert.ok(logs.some((l) => l.includes("[policy] DEGRADED member@gonimbly.com") && l.includes("profile API down")), logs.join("\n"));
  });

  test("shadow mode: binary enforcement with diff logging against the profile policy", async () => {
    // Binary denies audit logs to members; the profile (techAdmin) would allow → diff
    const resolver = stubResolver(makePolicy(["Shadow Test"], { techAdmin: true }));
    const { client, access } = await buildSessionClient(SELF, "member", "shadow", resolver);
    assert.equal(access, "member — calls and stats are limited to your own activity");
    assert.throws(() => (client as any).getLogs(), AccessDeniedError);
    assert.ok(logs.some((l) => l.includes("SHADOW diff getLogs")), logs.join("\n"));
  });

  test("shadow mode: resolver failure yields a plain binary client with no shadow logging", async () => {
    const { client } = await buildSessionClient(SELF, "member", "shadow", failingResolver);
    assert.throws(() => (client as any).getLogs(), AccessDeniedError);
    assert.ok(logs.some((l) => l.includes("[policy] DEGRADED")), logs.join("\n"));
    assert.ok(!logs.some((l) => l.includes("SHADOW diff")), logs.join("\n"));
  });
});
