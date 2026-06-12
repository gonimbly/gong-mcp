import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import { listWorkspaceRefs } from "./workspace.js";

export function registerPermissionTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_permission_profiles",
    "List permission profiles. Covers every workspace unless workspaceId is given (the API requires a " +
      "workspace, so the tool sweeps all of them by default).",
    {
      workspaceId: z.string().optional().describe("Restrict to one workspace (default: all workspaces, labeled)"),
    },
    async (args) => {
      const targets = args.workspaceId
        ? [{ id: args.workspaceId, name: undefined as string | undefined }]
        : await listWorkspaceRefs(client);
      const perWorkspace = [];
      for (const ws of targets) {
        const data = await client.listAllPermissionProfiles(ws.id) as { profiles?: unknown[] };
        perWorkspace.push({ workspaceId: ws.id, workspaceName: ws.name, profiles: data.profiles ?? [] });
      }
      const payload = args.workspaceId ? perWorkspace[0] : { workspaces: perWorkspace };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
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
