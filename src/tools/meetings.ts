import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerMeetingTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_create_meeting",
    "Create a Gong meeting to be recorded. Returns a join URL and meeting ID.",
    {
      title: z.string().describe("Meeting title"),
      startTime: z.string().describe("ISO 8601 start time"),
      durationMinutes: z.number().describe("Duration in minutes"),
      organizerUserId: z.string().optional().describe("Gong user ID of the organizer"),
      attendeeEmails: z.array(z.string()).optional().describe("Attendee email addresses"),
    },
    async (args) => {
      const data = await client.createMeeting({
        title: args.title,
        startTime: args.startTime,
        durationMinutes: args.durationMinutes,
        organizerUserId: args.organizerUserId,
        attendeeEmails: args.attendeeEmails,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_update_meeting",
    "Update an existing Gong meeting's details.",
    {
      meetingId: z.string().describe("The Gong meeting ID"),
      title: z.string().optional().describe("New meeting title"),
      startTime: z.string().optional().describe("New start time (ISO 8601)"),
      durationMinutes: z.number().optional().describe("New duration in minutes"),
    },
    async (args) => {
      const { meetingId, ...body } = args;
      const data = await client.updateMeeting(meetingId, body);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_delete_meeting",
    "Delete a Gong meeting.",
    {
      meetingId: z.string().describe("The Gong meeting ID to delete"),
    },
    async (args) => {
      const data = await client.deleteMeeting(args.meetingId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
