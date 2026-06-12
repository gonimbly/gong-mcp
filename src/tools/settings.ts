import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import type { GongIdentity } from "../gong/identity.js";

const DAY_MS = 86400_000;

/** Coaching takes ISO datetimes; a date-only value gets T00:00:00Z appended. */
function coachingDateTime(value: string | undefined, fallbackMs: number): string {
  if (!value) return new Date(fallbackMs).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

/** Resolve the workspace when the caller didn't pass one: unambiguous for a
 * single-workspace org, otherwise an error that lists the real choices. */
async function defaultWorkspaceId(client: GongClient): Promise<string> {
  const { workspaces } = await client.listWorkspaces() as { workspaces?: Array<{ id?: string; name?: string }> };
  const all = (workspaces ?? []).filter((w) => w.id != null);
  if (all.length === 1) return String(all[0].id);
  const list = all.map((w) => `"${w.name}"=${w.id}`).join(", ");
  throw new Error(`workspaceId is required — this org has ${all.length} workspaces: ${list}`);
}

export function registerSettingsTools(server: McpServer, client: GongClient, identity?: GongIdentity) {
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
    "Get Gong coaching metrics for a MANAGER's team (coaching data is manager-centric): feedback given, " +
      "calls listened to, scorecards filled. Defaults to the connected user as the manager — pass managerId " +
      "(a Gong userId, see gong_find_user) for someone else's team.",
    {
      workspaceId: z.string().optional().describe(
        "Workspace ID (auto-resolved when the org has exactly one; otherwise see gong_list_workspaces)"
      ),
      managerId: z.string().optional().describe(
        "Gong userId of the manager whose coaching view to fetch (default: the connected user)"
      ),
      fromDateTime: z.string().optional().describe("ISO 8601 datetime start (default: 30 days ago)"),
      toDateTime: z.string().optional().describe("ISO 8601 datetime end (default: now)"),
    },
    async (args) => {
      const managerId = args.managerId ?? identity?.userId;
      if (!managerId) {
        throw new Error(
          "managerId is required when no user identity is connected — pass the manager's Gong userId " +
          "(resolve names with gong_find_user)."
        );
      }
      const data = await client.getCoaching({
        workspaceId: args.workspaceId ?? await defaultWorkspaceId(client),
        managerId,
        from: coachingDateTime(args.fromDateTime, Date.now() - 30 * DAY_MS),
        to: coachingDateTime(args.toDateTime, Date.now()),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
