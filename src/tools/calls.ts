import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerCallTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_list_calls",
    "List Gong calls with optional date range and workspace filters. Returns call metadata including title, duration, participants, and date.",
    {
      fromDateTime: z.string().optional().describe("ISO 8601 start date, e.g. 2024-01-01T00:00:00Z"),
      toDateTime: z.string().optional().describe("ISO 8601 end date, e.g. 2024-01-31T23:59:59Z"),
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
    },
    async (args) => {
      const data = await client.listCalls(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_call",
    "Get full details for a specific Gong call by ID, including participants, duration, topics, and scores.",
    {
      callId: z.string().describe("The Gong call ID"),
    },
    async (args) => {
      const data = await client.getCall(args.callId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_transcript",
    "Get the full transcript of a Gong call. Returns speaker-attributed, timestamped sentences.",
    {
      callId: z.string().describe("The Gong call ID"),
    },
    async (args) => {
      const data = await client.getCallTranscript(args.callId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_search_calls",
    "Search Gong calls with enriched content: topics discussed, tracker mentions, key points, next steps, call outcomes, and speaker stats.",
    {
      fromDateTime: z.string().optional().describe("ISO 8601 start date"),
      toDateTime: z.string().optional().describe("ISO 8601 end date"),
    },
    async (args) => {
      const data = await client.searchCalls("", args.fromDateTime, args.toDateTime);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_call_highlights",
    "Get points of interest and highlights for a call: key moments, action items, questions asked, and topics.",
    {
      callId: z.string().describe("The Gong call ID"),
    },
    async (args) => {
      const data = await client.getCallPoints(args.callId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
