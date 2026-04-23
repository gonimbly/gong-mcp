import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerLogTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_audit_logs",
    "Get Gong audit logs: API calls, user logins, setting changes, data exports. Useful for compliance and security reviews.",
    {
      fromDateTime: z.string().optional().describe("ISO 8601 start date"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getLogs(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
