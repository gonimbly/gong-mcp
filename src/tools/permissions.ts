import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerPermissionTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_permission_profiles",
    "List all permission profiles defined in the Gong workspace.",
    {
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
    },
    async (args) => {
      const data = await client.listAllPermissionProfiles(args.workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_permission_profile",
    "Get details of a specific permission profile including its access rules.",
    {
      profileId: z.string().describe("The permission profile ID"),
    },
    async (args) => {
      const data = await client.getPermissionProfile(args.profileId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_permission_profile_users",
    "Get all users assigned to a specific permission profile.",
    {
      profileId: z.string().describe("The permission profile ID"),
    },
    async (args) => {
      const data = await client.getPermissionProfileUsers(args.profileId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
