import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

const dateFilter = {
  fromDateTime: z.string().describe("Start of date range (ISO 8601 or YYYY-MM-DD)"),
  toDateTime: z.string().describe("End of date range (ISO 8601 or YYYY-MM-DD)"),
  userIds: z.array(z.string()).optional().describe("Filter by specific user IDs (omit for all users)"),
  workspaceId: z.string().optional().describe("Filter by workspace ID"),
};

// Gong's stats API requires fromDate/toDate (YYYY-MM-DD), not fromDateTime/toDateTime.
function toStatsFilter(args: {
  fromDateTime: string;
  toDateTime: string;
  userIds?: string[];
  workspaceId?: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  const { fromDateTime, toDateTime, ...rest } = args;
  return { ...rest, fromDate: fromDateTime.slice(0, 10), toDate: toDateTime.slice(0, 10) };
}

export function registerStatsTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_activity_aggregate",
    "Get aggregated activity stats for reps over a date range: total calls, talk ratio, longest monologue, interactivity score, patience, topics covered.",
    dateFilter,
    async (args) => {
      const data = await client.getActivityAggregate({ filter: toStatsFilter(args) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_activity_by_period",
    "Get activity stats broken down by time period (weekly/monthly) — useful for tracking rep performance trends over time.",
    {
      ...dateFilter,
      periodSize: z.enum(["Weekly", "Monthly"]).optional().describe("Period grouping"),
    },
    async (args) => {
      const data = await client.getActivityAggregateByPeriod({ filter: toStatsFilter(args) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_activity_day_by_day",
    "Get day-by-day activity stats per rep. Good for spotting specific days with high/low activity.",
    dateFilter,
    async (args) => {
      const data = await client.getActivityDayByDay({ filter: toStatsFilter(args) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_scorecard_stats",
    "Get scorecard completion and scoring stats for reps over a date range. Shows how reps perform on coached behaviors.",
    {
      ...dateFilter,
      scorecardIds: z.array(z.string()).optional().describe("Filter by specific scorecard IDs"),
    },
    async (args) => {
      const data = await client.getScorecardStats({ filter: toStatsFilter(args) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_interaction_stats",
    "Get interaction-level stats: talk/listen ratio, filler words, interruptions, longest monologue per call.",
    dateFilter,
    async (args) => {
      const data = await client.getInteractionStats({ filter: toStatsFilter(args) });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
