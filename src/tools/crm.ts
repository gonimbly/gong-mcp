import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerCrmTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_crm_entities",
    "Get CRM entities synced into Gong (accounts, contacts, opportunities, leads) with their field values.",
    {
      crmObjectType: z.enum(["Account", "Contact", "Opportunity", "Lead"]).describe("CRM object type"),
      fromDateTime: z.string().optional().describe("Only return entities updated after this date"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getCrmEntities(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_entity_schema",
    "Get the field schema for a CRM object type as configured in Gong — shows which CRM fields are mapped and synced.",
    {
      crmObjectType: z.enum(["Account", "Contact", "Opportunity", "Lead"]).describe("CRM object type"),
    },
    async (args) => {
      const data = await client.getCrmEntitySchema(args.crmObjectType);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_integrations",
    "Get the CRM integration configuration for this Gong workspace (e.g. Salesforce connection details).",
    {},
    async () => {
      const data = await client.getCrmIntegrations();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_request_status",
    "Check the status of an async CRM data ingestion request.",
    {
      requestId: z.string().describe("The async request ID returned from a CRM upsert call"),
    },
    async (args) => {
      const data = await client.getCrmRequestStatus(args.requestId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
