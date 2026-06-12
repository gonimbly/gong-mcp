import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerUserTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_users",
    "List all Gong users in the workspace with name, email, title, manager, and active status. To resolve a name or email to a user, prefer gong_find_user.",
    {
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.listUsers({ cursor: args.cursor });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_user",
    "Get full details for a specific Gong user by ID.",
    {
      userId: z.string().describe("The Gong user ID"),
    },
    async (args) => {
      const data = await client.getUser(args.userId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_user_settings_history",
    "Get the settings change history for a specific Gong user (e.g. role changes, recording settings).",
    {
      userId: z.string().describe("The Gong user ID"),
    },
    async (args) => {
      const data = await client.getUserSettingsHistory(args.userId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_extensive_users",
    "Get users with extended filters: by email, name, CRM ID, or active status. Useful for user lookups when you don't have the Gong user ID.",
    {
      emails: z.array(z.string()).optional().describe("Filter by email addresses"),
      userIds: z.array(z.string()).optional().describe("Filter by Gong user IDs"),
      includeAvatars: z.boolean().optional().describe("Include avatar URLs"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getExtensiveUsers({
        filter: {
          emails: args.emails,
          userIds: args.userIds,
          includeAvatars: args.includeAvatars,
        },
        cursor: args.cursor,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
