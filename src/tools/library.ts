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

  server.tool(
    "gong_library_folder_recap",
    "Get a recap of all calls in a Gong library folder in one shot: fetches the folder's call list then enriches each call via calls/extensive. Implements the 'library → batch extensive' pipeline pattern. Use gong_list_library_folders to find folder IDs.",
    {
      folderId: z.string().describe("Library folder ID (from gong_list_library_folders)"),
      includeBrief: z.boolean().optional().default(true).describe("Include AI-generated brief"),
      includeKeyPoints: z.boolean().optional().default(true).describe("Include key points"),
      includeOutline: z.boolean().optional().default(false).describe("Include structured call outline"),
      includeNextSteps: z.boolean().optional().default(false).describe("Include next steps"),
      includeTopics: z.boolean().optional().default(false).describe("Include topics discussed"),
    },
    async (args) => {
      const folder = await client.getLibraryFolderContent(args.folderId) as { calls?: { id: string }[] };
      const callIds = (folder.calls ?? []).map((c) => c.id);
      if (callIds.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ folderId: args.folderId, calls: [] }) }] };
      }
      const data = await client.getExtensiveCalls({
        filter: { callIds },
        contentSelector: {
          exposedFields: {
            content: {
              brief: args.includeBrief,
              keyPoints: args.includeKeyPoints,
              outline: args.includeOutline,
              nextSteps: args.includeNextSteps,
              topics: args.includeTopics,
            },
          },
        },
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
