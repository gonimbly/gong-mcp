import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { resolveGongIdentity } = await import("./identity.js");

const PAGE_ONE = {
  users: [{ id: "111", emailAddress: "first@gonimbly.com", firstName: "First", lastName: "Page" }],
  records: { cursor: "page2" },
};
const PAGE_TWO = {
  users: [{ id: "222", emailAddress: "second@gonimbly.com", firstName: "Second", lastName: "Page" }],
  records: {},
};

let fetchCount = 0;

globalThis.fetch = (async (input: any) => {
  fetchCount++;
  const url = String(input);
  const page = url.includes("cursor=page2") ? PAGE_TWO : PAGE_ONE;
  return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const client = new GongClient();

beforeEach(() => {
  fetchCount = 0;
});

describe("resolveGongIdentity", () => {
  test("finds a user on a later page by paginating", async () => {
    const identity = await resolveGongIdentity(client, "second@gonimbly.com");
    assert.ok(identity);
    assert.equal(identity.userId, "222");
    assert.equal(identity.fullName, "Second Page");
    assert.equal(fetchCount, 2);
  });

  test("caches resolved identities", async () => {
    await resolveGongIdentity(client, "first@gonimbly.com");
    assert.equal(fetchCount, 1);
    const again = await resolveGongIdentity(client, "first@gonimbly.com");
    assert.equal(again?.userId, "111");
    assert.equal(fetchCount, 1, "second lookup must hit the cache");
  });

  test("matches email case-insensitively", async () => {
    const identity = await resolveGongIdentity(client, "FIRST@Gonimbly.com");
    assert.equal(identity?.userId, "111");
  });

  test("returns null for an email with no Gong account", async () => {
    const identity = await resolveGongIdentity(client, "ghost@gonimbly.com");
    assert.equal(identity, null);
    assert.equal(fetchCount, 2, "must have exhausted all pages");
  });
});
