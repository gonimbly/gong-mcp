import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GongClient } from "../gong/client.js";
import { registerEntityTools } from "./entities.js";

const AI_TOOLS = ["gong_ask_account", "gong_ask_deal", "gong_generate_brief"];

// Stand up a real MCP server with only the entity tools registered, wired to a
// real client over an in-memory transport — so we exercise the actual SDK
// tools/list + tools/call paths, not internals. registerEntityTools reads the
// flag at registration time, so set/clear the env BEFORE calling this.
async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerEntityTools(server, new GongClient("https://api.gong.io"));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

afterEach(() => {
  delete process.env.GONG_ENABLE_AI_ENTITIES;
});

describe("entity tools — disabled by default (paid credit endpoints)", () => {
  test("the three AI tools are NOT advertised in tools/list when disabled", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of AI_TOOLS) {
        assert.ok(!names.includes(name), `${name} should be hidden from the tool list`);
      }
    } finally {
      await close();
    }
  });

  test("a stale by-name call to a disabled tool returns a 'disabled' message, not a credit call", async () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    const { client, close } = await connect();
    try {
      // Simulates a previous skill version that still has the tool cached. The SDK
      // answers a call to a disabled tool with an error RESULT (isError: true) whose
      // text says the tool is disabled — so Claude reads a clear message and no paid
      // request is ever made.
      const res = await client.callTool({ name: "gong_ask_account", arguments: { crmAccountId: "a", question: "q" } });
      assert.equal(res.isError, true, "a disabled-tool call must come back as an error result");
      const text = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join(" ");
      assert.match(text, /disabled/i, "the message should tell Claude the tool is disabled");
    } finally {
      await close();
    }
  });

  test("the three AI tools ARE advertised when explicitly enabled", async () => {
    process.env.GONG_ENABLE_AI_ENTITIES = "true";
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of AI_TOOLS) {
        assert.ok(names.includes(name), `${name} should be listed when opted in`);
      }
    } finally {
      await close();
    }
  });
});
