import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

// Gong's AI layer: natural-language Q&A and auto-generated briefs for CRM entities

const ENTITY_TYPES = ["Account", "Opportunity", "Contact"] as const;

export function registerEntityTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_ask_entity",
    "Ask Gong's AI a natural-language question about a CRM entity (account, opportunity, or contact). Gong synthesizes answers from all related call activity. Example questions: 'What are the main pain points?', 'What competitors came up?', 'What are the open risks?'",
    {
      entityType: z.enum(ENTITY_TYPES).describe("Type of CRM entity"),
      entityId: z.string().describe("CRM entity ID (from your CRM, e.g. Salesforce account ID)"),
      question: z.string().describe("Natural-language question to ask about this entity"),
    },
    async (args) => {
      const data = await client.askEntity(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_entity_brief",
    "Get Gong's AI-generated executive brief for a CRM entity. Summarizes recent call activity, relationship status, key themes, and risks — synthesized from all recorded calls related to the entity.",
    {
      entityType: z.enum(ENTITY_TYPES).describe("Type of CRM entity"),
      entityId: z.string().describe("CRM entity ID (e.g. Salesforce account/opportunity ID)"),
    },
    async (args) => {
      const data = await client.getEntityBrief(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
