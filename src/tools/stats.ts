import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GongApiError, type GongClient } from "../gong/client.js";

const DAY_MS = 86400_000;

/**
 * Stats endpoints take DATE-ONLY values (filter.fromDate / filter.toDate) —
 * never ISO datetimes — and reject dates past "today" in the org's timezone,
 * so the default range ends yesterday. ISO datetimes are accepted here by
 * truncation so a model passing 2026-06-01T00:00:00Z still succeeds.
 * (Verified live 2026-06-12: npm run probe:stats-coaching.)
 */
export function statsDateRange(args: { fromDate?: string; toDate?: string }): { fromDate: string; toDate: string } {
  const norm = (value: string | undefined, fallbackMs: number, name: string): string => {
    const s = (value ?? new Date(fallbackMs).toISOString()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new Error(`Invalid ${name} "${value}" — stats endpoints take date-only YYYY-MM-DD values.`);
    }
    return s;
  };
  return {
    fromDate: norm(args.fromDate, Date.now() - 30 * DAY_MS, "fromDate"),
    toDate: norm(args.toDate, Date.now() - DAY_MS, "toDate"),
  };
}

interface StatsArgs {
  fromDate?: string;
  toDate?: string;
  userIds?: string[];
  workspaceId?: string;
}

export function statsFilter(args: StatsArgs): Record<string, unknown> {
  return {
    ...statsDateRange(args),
    ...(args.userIds?.length ? { userIds: args.userIds } : {}),
    ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
  };
}

const dateFilter = {
  fromDate: z.string().optional().describe(
    "Start date, date-only YYYY-MM-DD (NOT a datetime — a datetime's date part is used). Default: 30 days ago."
  ),
  toDate: z.string().optional().describe(
    "End date, date-only YYYY-MM-DD. Must not be in the future (org timezone). Default: yesterday."
  ),
  userIds: z.array(z.string()).optional().describe("Filter by specific Gong user IDs (omit for all visible users)"),
  workspaceId: z.string().optional().describe("Filter by workspace ID"),
};

/** Gong 404s stats requests when none of the requested users have data in the
 * range — that is an empty result, not an error (live quirk). */
async function statsResult(fetchStats: () => Promise<unknown>) {
  try {
    const data = await fetchStats();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    if (err instanceof GongApiError && err.status === 404) {
      const noData = {
        noData: true,
        note: "Gong has no stats data for the requested users in this date range.",
        detail: err.message,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(noData, null, 2) }] };
    }
    throw err;
  }
}

export function registerStatsTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_activity_aggregate",
    "Get aggregated activity stats for reps over a date range: total calls, talk ratio, longest monologue, " +
      "interactivity score, patience, topics covered. Dates are DATE-ONLY (YYYY-MM-DD) and default to the " +
      "last 30 days.",
    dateFilter,
    async (args) => statsResult(() => client.getActivityAggregate({ filter: statsFilter(args) }))
  );

  server.tool(
    "gong_get_activity_by_period",
    "Get activity stats bucketed by period (day/week/month/quarter) — for tracking rep performance trends " +
      "over time. Dates are DATE-ONLY (YYYY-MM-DD) and default to the last 30 days.",
    {
      ...dateFilter,
      aggregationPeriod: z.enum(["DAY", "WEEK", "MONTH", "QUARTER"]).optional()
        .describe("Bucket size (default WEEK)"),
    },
    async (args) =>
      statsResult(() => client.getActivityAggregateByPeriod({
        filter: statsFilter(args),
        aggregationPeriod: args.aggregationPeriod ?? "WEEK",
      }))
  );

  server.tool(
    "gong_get_activity_day_by_day",
    "Get day-by-day activity stats per rep. Good for spotting specific days with high/low activity. " +
      "Responses are LARGE for a whole org (1+ MB) — pass userIds to keep them small. Dates are DATE-ONLY " +
      "(YYYY-MM-DD) and default to the last 30 days.",
    dateFilter,
    async (args) => statsResult(() => client.getActivityDayByDay({ filter: statsFilter(args) }))
  );

  server.tool(
    "gong_get_scorecard_stats",
    "Get scorecard completion and scoring stats for reps over a date range. Shows how reps perform on " +
      "coached behaviors. Dates are DATE-ONLY (YYYY-MM-DD) and default to the last 30 days.",
    {
      ...dateFilter,
      scorecardIds: z.array(z.string()).optional().describe("Filter by specific scorecard IDs"),
    },
    async (args) =>
      statsResult(() => client.getScorecardStats({
        filter: { ...statsFilter(args), ...(args.scorecardIds?.length ? { scorecardIds: args.scorecardIds } : {}) },
      }))
  );

  server.tool(
    "gong_get_interaction_stats",
    "Get interaction-level stats: talk/listen ratio, filler words, interruptions, longest monologue. Only " +
      "covers users with Gong analytics data — requesting userIds without data returns noData rather than " +
      "stats. Dates are DATE-ONLY (YYYY-MM-DD) and default to the last 30 days.",
    dateFilter,
    async (args) => statsResult(() => client.getInteractionStats({ filter: statsFilter(args) }))
  );
}
