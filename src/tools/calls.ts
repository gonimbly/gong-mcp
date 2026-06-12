import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerCallTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_calls",
    "List Gong calls (paginated). Returns call metadata: title, duration, participants, date, workspace. Use cursor for pagination. For questions about a specific person's or client's calls, use gong_find_calls instead.",
    {
      fromDateTime: z.string().optional().describe("ISO 8601 start date e.g. 2024-01-01T00:00:00Z"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
    },
    async (args) => {
      const data = await client.listCalls(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_call",
    "Get full metadata for a specific Gong call by ID: participants, duration, direction, language, topics, scores.",
    {
      callId: z.string().describe("The Gong call ID"),
    },
    async (args) => {
      const data = await client.getCall(args.callId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_transcripts",
    "Get speaker-attributed, timestamped transcripts for one or more Gong calls.",
    {
      callIds: z.array(z.string()).describe("List of Gong call IDs (up to 100)"),
    },
    async (args) => {
      const data = await client.getCallTranscripts(args.callIds);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_extensive_calls",
    "Get calls with fully enriched content: topics, trackers, brief summary, key points, call outcome, next steps, speaker interaction stats, and questions. Use contentSelector to control which fields are returned. Responses are LARGE — for finding a person's or client's calls use gong_find_calls, and for a one-call digest use gong_call_summary instead.",
    {
      fromDateTime: z.string().optional().describe("ISO 8601 start date"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
      userIds: z.array(z.string()).optional().describe("Filter by rep user IDs"),
      cursor: z.string().optional().describe("Pagination cursor"),
      includeTopics: z.boolean().optional().default(true).describe("Include topics discussed"),
      includeTrackers: z.boolean().optional().default(true).describe("Include tracker mentions"),
      includeBrief: z.boolean().optional().default(true).describe("Include AI-generated brief"),
      includeOutline: z.boolean().optional().default(false).describe("Include structured call outline"),
      includeHighlights: z.boolean().optional().default(false).describe("Include curated highlight moments"),
      includeKeyPoints: z.boolean().optional().default(true).describe("Include key points"),
      includeOutcome: z.boolean().optional().default(true).describe("Include call outcome"),
      includeNextSteps: z.boolean().optional().default(true).describe("Include next steps"),
      includeSpeakerStats: z.boolean().optional().default(true).describe("Include speaker interaction stats"),
      includeQuestions: z.boolean().optional().default(true).describe("Include questions asked"),
    },
    async (args) => {
      const data = await client.getExtensiveCalls({
        filter: {
          fromDateTime: args.fromDateTime,
          toDateTime: args.toDateTime,
          workspaceId: args.workspaceId,
          userIds: args.userIds,
        },
        cursor: args.cursor,
        contentSelector: {
          exposedFields: {
            content: {
              topics: args.includeTopics,
              trackers: args.includeTrackers,
              brief: args.includeBrief,
              outline: args.includeOutline,
              highlights: args.includeHighlights,
              keyPoints: args.includeKeyPoints,
              callOutcome: args.includeOutcome,
              nextSteps: args.includeNextSteps,
            },
            interaction: {
              speakers: args.includeSpeakerStats,
              questions: args.includeQuestions,
            },
          },
        },
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_list_call_outcomes",
    "List all configured call outcome labels in the Gong workspace (e.g. 'Qualified', 'Not Interested', 'Follow-up Needed').",
    {},
    async () => {
      const data = await client.listCallOutcomes();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
