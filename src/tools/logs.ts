import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerLogTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_audit_logs",
    "Get Gong audit logs: user activity, logins, setting changes, data exports. Useful for compliance and " +
      "security reviews. Responses can be large — narrow the date range.",
    {
      logType: z.string().optional().describe(
        'Log type, required by the API (default "UserActivityLog" — the standard audit log)'
      ),
      fromDateTime: z.string().optional().describe("ISO 8601 start date"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getLogs({ ...args, logType: args.logType ?? "UserActivityLog" });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
