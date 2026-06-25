import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("../gong/client.js");
const { registerEntityContextTools } = await import("./entityContext.js");

// Minimal fake: one Acme-linked call, enough to prove an end-to-end round trip.
const CALL = {
  metaData: { id: "c-1", workspaceId: "ws-1", title: "Acme sync", started: "2026-06-10T10:00:00Z", duration: 1800 },
  parties: [{ name: "Bob", emailAddress: "bob@acme.com", affiliation: "External" }],
  context: [{ system: "Salesforce", objects: [{ objectType: "Account", objectId: "001X", fields: [{ name: "Name", value: "Acme Corp" }] }] }],
  content: { brief: "A short brief." },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  if (url.includes("/v2/calls/extensive")) {
    const ids: string[] | undefined = body?.filter?.callIds;
    const exposed = body?.contentSelector?.exposedFields ?? {};
    const withContext = body?.contentSelector?.context === "Extended";
    const calls = (ids && !ids.includes("c-1") ? [] : [CALL]).map((c) => ({
      metaData: c.metaData,
      ...(exposed.parties === true ? { parties: c.parties } : {}),
      ...(withContext && c.context ? { context: c.context } : {}),
      ...(exposed.content && c.content ? { content: c.content } : {}),
    }));
    if (calls.length === 0) return json({ errors: ["No calls found corresponding to the provided filters"] }, 404);
    return json({ calls, records: { totalRecords: calls.length } });
  }
  if (url.includes("/v2/users")) return json({ users: [], records: { totalRecords: 0 } });
  return json({ ok: true });
}) as typeof fetch;

async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerEntityContextTools(server, new GongClient());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

afterEach(() => { delete process.env.GONG_ENABLE_AI_ENTITIES; });

describe("gong_entity_context tool — credit-free, always available", () => {
  test("is listed even when the paid AI tools are disabled (flag off)", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const { client, close } = await connect();
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(names.includes("gong_entity_context"), "gong_entity_context must be advertised by default");
    } finally { await close(); }
  });

  test("is still listed when the paid AI tools are enabled (flag on) — they coexist", async () => {
    process.env.GONG_ENABLE_AI_ENTITIES = "true";
    const { client, close } = await connect();
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(names.includes("gong_entity_context"));
    } finally { await close(); }
  });

  test("returns aggregated entity context (no credit endpoint touched)", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "gong_entity_context", arguments: { crmEntityType: "ACCOUNT", entityRef: "001X" } });
      assert.ok(!res.isError, "should not error");
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      assert.deepEqual(payload.entity, { crmEntityType: "ACCOUNT", entityRef: "001X" });
      assert.deepEqual(payload.calls.map((c: { id: string }) => c.id), ["c-1"]);
      assert.equal(payload.calls[0].brief, "A short brief.");
    } finally { await close(); }
  });
});
