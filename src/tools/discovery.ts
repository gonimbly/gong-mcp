import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import type { GongIdentity } from "../gong/identity.js";
import { findCalls, findMyCalls, summarizeCall } from "../gong/discovery.js";
import { loadUserDirectory, matchDirectoryUsers } from "../gong/directory.js";

const FIND_USER_DISPLAY_CAP = 25;

/**
 * Composite call-discovery tools. `identity` is the connected user when the
 * gateway built this session; stdio mode has no resolved identity, so
 * `gong_my_calls` is only registered when one is provided.
 */
export function registerDiscoveryTools(server: McpServer, client: GongClient, identity?: GongIdentity) {
  server.tool(
    "gong_find_calls",
    "Find Gong calls by participant (name or email), client/account, and/or title text in a date range. " +
      "ALWAYS prefer this over gong_list_calls or gong_get_extensive_calls with manual filtering when the " +
      "question is about a person's or a client's calls — it scans multiple pages server-side, matches " +
      "participants by Gong user, email, or display name (external attendees included), matches accounts via " +
      "CRM context, call titles, and external email domains, and returns compact results with a coverage " +
      "report (scanned/matched/truncated).",
    {
      participant: z.string().optional().describe(
        "Person to find calls for: partial name or email, case-insensitive (e.g. 'nikki' or 'nikki@acme.com'). " +
        "Matches Gong users AND external attendees."
      ),
      account: z.string().optional().describe(
        "Client/account name or email-domain fragment (e.g. 'Acme' or 'acme.com'). Matched against CRM account " +
        "context, call titles, and external participants' email domains."
      ),
      titleContains: z.string().optional().describe("Case-insensitive substring of the call title"),
      fromDateTime: z.string().optional().describe("ISO 8601 start (default: 30 days ago)"),
      toDateTime: z.string().optional().describe("ISO 8601 end (default: now)"),
      workspaceId: z.string().optional().describe("Restrict to one workspace"),
      maxPages: z.number().int().min(1).max(10).optional().describe(
        "API pages to scan, 100 calls each (default 5, max 10). Raise for wide date ranges; the coverage " +
        "report says whether the scan was truncated."
      ),
    },
    async (args) => {
      const data = await findCalls(client, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  if (identity) {
    server.tool(
      "gong_my_calls",
      "List the connected user's own Gong calls in a date range (default: last 30 days). Use for 'my calls', " +
        "'my meetings last week' — do not scan gong_list_calls manually. Returns compact results with a " +
        "coverage report.",
      {
        fromDateTime: z.string().optional().describe("ISO 8601 start (default: 30 days ago)"),
        toDateTime: z.string().optional().describe("ISO 8601 end (default: now)"),
        workspaceId: z.string().optional().describe("Restrict to one workspace"),
        maxPages: z.number().int().min(1).max(10).optional().describe(
          "API pages to scan, 100 calls each (default 5, max 10)"
        ),
      },
      async (args) => {
        const data = await findMyCalls(client, identity, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }
    );
  }

  server.tool(
    "gong_find_user",
    "Resolve a name or email fragment to Gong user(s): id, email, title, active status, manager. Use this " +
      "first when you only have a person's name. Returns ALL matches — if several, ask the user which one " +
      "before proceeding.",
    {
      query: z.string().min(1).describe("Name or email fragment, case-insensitive (e.g. 'brian' or 'brian@gonimbly.com')"),
    },
    async (args) => {
      const directory = await loadUserDirectory(client);
      const matches = matchDirectoryUsers(directory, args.query);
      const byId = new Map(directory.map((u) => [u.userId, u]));
      const data = {
        matches: matches.slice(0, FIND_USER_DISPLAY_CAP).map((u) => ({
          userId: u.userId,
          name: u.fullName,
          email: u.email,
          title: u.title,
          active: u.active,
          managerId: u.managerId,
          managerName: u.managerId ? byId.get(u.managerId)?.fullName : undefined,
        })),
        totalMatches: matches.length,
        totalDirectoryUsers: directory.length,
        ...(matches.length > FIND_USER_DISPLAY_CAP
          ? { note: `Showing ${FIND_USER_DISPLAY_CAP} of ${matches.length} matches — refine the query.` }
          : {}),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_call_summary",
    "Compact one-call digest: outcome, brief, key points, next steps, topics, trackers, participants, CRM " +
      "account — WITHOUT the transcript. Use this instead of gong_get_transcripts or gong_get_extensive_calls " +
      "to answer 'what was this call about'; fetch the transcript only when exact quotes are needed.",
    {
      callId: z.string().describe("The Gong call ID"),
    },
    async (args) => {
      const data = await summarizeCall(client, args.callId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
