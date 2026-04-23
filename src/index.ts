#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GongClient } from "./gong/client.js";
import { registerCallTools } from "./tools/calls.js";
import { registerUserTools } from "./tools/users.js";
import { registerStatsTools } from "./tools/stats.js";

const ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const ACCESS_KEY_SECRET = process.env.GONG_ACCESS_KEY_SECRET;

if (!ACCESS_KEY || !ACCESS_KEY_SECRET) {
  console.error("Missing required env vars: GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET");
  process.exit(1);
}

const client = new GongClient({ accessKey: ACCESS_KEY, accessKeySecret: ACCESS_KEY_SECRET });

const server = new McpServer({ name: "gong-mcp", version: "0.1.0" });

registerCallTools(server, client);
registerUserTools(server, client);
registerStatsTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
