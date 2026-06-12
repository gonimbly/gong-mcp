import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerSettingsTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_scorecards",
    "List all scorecards configured in Gong. Returns scorecard name, questions, and which teams they apply to.",
    {},
    async () => {
      const data = await client.listScorecards();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_list_trackers",
    "List all business trackers configured in Gong (keywords and phrases tracked across calls, e.g. competitor mentions, pricing discussions).",
    {},
    async () => {
      const data = await client.listTrackers();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_list_workspaces",
    "List all Gong workspaces in the organization.",
    {},
    async () => {
      const data = await client.listWorkspaces();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_coaching",
    "Get coaching data for reps: coaching sessions, feedback given, and behavior improvements over time.",
    {
      workspaceId: z.string().describe("Workspace ID (required by Gong — use gong_list_workspaces to find yours)"),
      fromDateTime: z.string().optional().describe("ISO 8601 start date"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
      userId: z.string().optional().describe("Filter by specific rep user ID"),
    },
    async (args) => {
      const data = await client.getCoaching(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
