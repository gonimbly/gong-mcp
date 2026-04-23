import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerUserTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_users",
    "List all Gong users in the workspace. Returns name, email, title, and manager info.",
    {},
    async () => {
      const data = await client.listUsers();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_user",
    "Get details for a specific Gong user by ID.",
    {
      userId: z.string().describe("The Gong user ID"),
    },
    async (args) => {
      const data = await client.getUser(args.userId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_user_activity",
    "Get activity stats for users over a date range: calls recorded, talk ratio, longest monologue, interactivity score.",
    {
      fromDateTime: z.string().describe("ISO 8601 start date"),
      toDateTime: z.string().describe("ISO 8601 end date"),
    },
    async (args) => {
      const data = await client.getUserStats("", args.fromDateTime, args.toDateTime);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
