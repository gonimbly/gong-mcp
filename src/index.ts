#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GongClient } from "./gong/client.js";
import { registerConfigureTool } from "./tools/configure.js";
import { registerCallTools } from "./tools/calls.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerUserTools } from "./tools/users.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerEntityContextTools } from "./tools/entityContext.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerCrmTools } from "./tools/crm.js";
import { registerFlowTools } from "./tools/flows.js";
import { registerMeetingTools } from "./tools/meetings.js";
import { registerPermissionTools } from "./tools/permissions.js";
import { registerDataPrivacyTools } from "./tools/dataprivacy.js";
import { registerLogTools } from "./tools/logs.js";

const client = new GongClient();
const server = new McpServer({ name: "gong-mcp", version: "0.2.0" });

// Always available — no credentials needed to call these
registerConfigureTool(server);

// All Gong tools — each will surface a clear error if credentials aren't set yet
registerCallTools(server, client);
// No resolved identity in stdio mode, so gong_my_calls is not registered here
registerDiscoveryTools(server, client);
registerUserTools(server, client);
registerStatsTools(server, client);
registerEntityTools(server, client);
registerEntityContextTools(server, client);
registerSettingsTools(server, client);
registerLibraryTools(server, client);
registerCrmTools(server, client);
registerFlowTools(server, client);
registerMeetingTools(server, client);
registerPermissionTools(server, client);
registerDataPrivacyTools(server, client);
registerLogTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
