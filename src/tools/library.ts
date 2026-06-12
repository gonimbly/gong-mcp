import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import { listWorkspaceRefs } from "./workspace.js";

export function registerLibraryTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_library_folders",
    "List Gong library folders — curated collections of call clips organized by team, topic, or use case. " +
      "Covers every workspace unless workspaceId is given.",
    {
      workspaceId: z.string().optional().describe("Restrict to one workspace (default: all workspaces, labeled)"),
    },
    async (args) => {
      // The bare endpoint 400s in a multi-workspace org, so default to
      // sweeping every workspace and labeling the results.
      const targets = args.workspaceId
        ? [{ id: args.workspaceId, name: undefined as string | undefined }]
        : await listWorkspaceRefs(client);
      const perWorkspace = [];
      for (const ws of targets) {
        const data = await client.listLibraryFolders(ws.id) as { folders?: unknown[] };
        perWorkspace.push({ workspaceId: ws.id, workspaceName: ws.name, folders: data.folders ?? [] });
      }
      const payload = args.workspaceId ? perWorkspace[0] : { workspaces: perWorkspace };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_library_folder_content",
    "Get the call clips and content inside a specific Gong library folder.",
    {
      folderId: z.string().describe("The library folder ID (from gong_list_library_folders)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getLibraryFolderContent(args.folderId, args.cursor);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
