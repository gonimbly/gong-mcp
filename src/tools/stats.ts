import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerStatsTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_account_activity",
    "Get Gong activity stats for specific accounts over a date range. Useful for understanding engagement levels with customers.",
    {
      accountIds: z.array(z.string()).describe("List of CRM account IDs to query"),
      fromDateTime: z.string().describe("ISO 8601 start date"),
      toDateTime: z.string().describe("ISO 8601 end date"),
    },
    async (args) => {
      const data = await client.getAccountActivity(args.accountIds, args.fromDateTime, args.toDateTime);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_list_library",
    "List all Gong library folders. Useful for finding saved call clips organized by topic or team.",
    {},
    async () => {
      const data = await client.listLibraryFolders();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
