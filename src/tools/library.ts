import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerLibraryTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_library_folders",
    "List all Gong library folders. These are curated collections of call clips organized by team, topic, or use case.",
    {},
    async () => {
      const data = await client.listLibraryFolders();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_library_folder_content",
    "Get the call clips and content inside a specific Gong library folder.",
    {
      folderId: z.string().describe("The library folder ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getLibraryFolderContent(args.folderId, args.cursor);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
