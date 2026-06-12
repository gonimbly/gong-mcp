import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerDataPrivacyTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_data_for_email",
    "Look up all Gong data associated with an EXTERNAL person's email address (calls, emails, meetings). " +
      "Used for GDPR/CCPA data subject requests. The API rejects internal Gong users' emails — this is for " +
      "third-party privacy lookups only.",
    {
      emailAddress: z.string().email().describe("The external person's email address to look up"),
    },
    async (args) => {
      const data = await client.getDataForEmail(args.emailAddress);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_data_for_phone",
    "Look up all Gong data associated with a phone number. Used for GDPR/CCPA data subject requests.",
    {
      phoneNumber: z.string().describe("The phone number to look up (E.164 format, e.g. +14155551234)"),
    },
    async (args) => {
      const data = await client.getDataForPhone(args.phoneNumber);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_erase_data_for_email",
    "Permanently erase all Gong data (calls, transcripts, recordings) associated with an email address. This action is irreversible — use for GDPR right-to-erasure requests.",
    {
      emailAddress: z.string().email().describe("The email address whose data should be erased"),
    },
    async (args) => {
      const data = await client.eraseDataForEmail(args.emailAddress);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_erase_data_for_phone",
    "Permanently erase all Gong data associated with a phone number. Irreversible — use for GDPR right-to-erasure requests.",
    {
      phoneNumber: z.string().describe("The phone number whose data should be erased (E.164 format)"),
    },
    async (args) => {
      const data = await client.eraseDataForPhone(args.phoneNumber);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
