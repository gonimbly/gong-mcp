import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GongClient } from "./client.js";

// Use the org-credential path so the request layer doesn't try the OAuth keychain.
process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";

const realFetch = globalThis.fetch;
let fetchCount = 0;

beforeEach(() => {
  fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GONG_ENABLE_AI_ENTITIES;
});

// The hard guarantee Gong asked for: routing to /v2/entities/ask-entity or
// /v2/entities/get-brief spends paid AI credits, so the request chokepoint must
// refuse them — for ANY caller — unless explicitly opted in.
describe("GongClient — paid AI credit-endpoint guard", () => {
  test("blocks ask-entity / get-brief BEFORE any fetch when disabled (the default)", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const c = new GongClient("https://api.gong.io");

    await assert.rejects(
      () => c.askAccount({ workspaceId: "ws", crmAccountId: "a", timePeriod: "THIS_MONTH", question: "q" }),
      /consume paid Gong AI credits/,
    );
    await assert.rejects(
      () => c.askDeal({ workspaceId: "ws", crmDealId: "d", timePeriod: "THIS_MONTH", question: "q" }),
      /disabled/,
    );
    await assert.rejects(
      () => c.generateBrief({ workspaceId: "ws", briefName: "B", crmEntityType: "ACCOUNT", crmEntityId: "a", timePeriod: "THIS_MONTH" }),
      /disabled/,
    );

    assert.equal(fetchCount, 0, "no paid request should ever leave the process while disabled");
  });

  test("lets the request reach fetch when explicitly enabled", async () => {
    process.env.GONG_ENABLE_AI_ENTITIES = "true";
    const c = new GongClient("https://api.gong.io");

    await c.askAccount({ workspaceId: "ws", crmAccountId: "a", timePeriod: "THIS_MONTH", question: "q" });

    assert.equal(fetchCount, 1, "the request reaches the Gong API once opted in");
  });

  test("never affects non-credit endpoints", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const c = new GongClient("https://api.gong.io");

    await c.listWorkspaces();

    assert.equal(fetchCount, 1, "ordinary endpoints are unaffected by the credit guard");
  });
});
