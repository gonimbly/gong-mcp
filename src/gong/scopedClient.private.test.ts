import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { ScopedGongClient, AccessDeniedError } = await import("./scopedClient.js");

const SELF = { userId: "222", email: "me@gonimbly.com" };

// n1 = normal (owner 300, SELF not a party). po = PRIVATE owned by SELF. px = PRIVATE owned by 300.
const CALLS = [
  { metaData: { id: "n1", isPrivate: false, primaryUserId: "300" }, parties: [{ userId: "300" }] },
  { metaData: { id: "po", isPrivate: true, primaryUserId: "222" }, parties: [{ userId: "222" }, { userId: "999" }] },
  { metaData: { id: "px", isPrivate: true, primaryUserId: "300" }, parties: [{ userId: "300" }, { userId: "222" }] }, // SELF attended but is NOT owner
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
  if (url.includes("/v2/calls")) return json({ calls: CALLS.map((c) => c.metaData), records: {} });
  return json({ ok: true });
}) as typeof fetch;

const admin = new ScopedGongClient(SELF as any, "admin");
const member = new ScopedGongClient(SELF as any, "member");

beforeEach(() => { requests = []; });

describe("ScopedGongClient: private calls are owner-only (admin passthrough)", () => {
  test("admin listCalls drops a private call they don't own", async () => {
    const r = await admin.listCalls({}) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.id).sort(), ["n1", "po"], "px (private, owned by 300) hidden from admin");
    assert.ok(!requests[0].url.includes("extensive"), "admin still uses the basic endpoint");
  });
  test("admin getExtensiveCalls drops a private call they don't own", async () => {
    const r = await admin.getExtensiveCalls({ filter: {} }) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.metaData.id).sort(), ["n1", "po"]);
  });
  test("admin getCall denies a private call they don't own, allows their own + normal", async () => {
    await assert.rejects(admin.getCall("px"), AccessDeniedError);
    await admin.getCall("po");
    await admin.getCall("n1");
  });
  test("admin transcripts of a non-owned private call are denied (id named)", async () => {
    await assert.rejects(admin.getCallTranscripts(["px"]), (e: Error) => {
      assert.ok(e instanceof AccessDeniedError); assert.ok(e.message.includes("px")); return true;
    });
    assert.ok(!requests.some((r) => r.url.includes("/transcript")));
  });
});

describe("ScopedGongClient: members get owner-only too (not just participant)", () => {
  test("a member who ATTENDED a private call they don't own cannot see it", async () => {
    // px has SELF as a party but owner is 300 → owner-only hides it from the member.
    const r = await member.getExtensiveCalls({ filter: {} }) as { calls: any[] };
    assert.deepEqual(r.calls.map((c) => c.metaData.id).sort(), ["po"], "only SELF's own calls: po (owns), px hidden, n1 not a party");
    await assert.rejects(member.getCall("px"), AccessDeniedError);
    await member.getCall("po"); // owns it
  });
});
