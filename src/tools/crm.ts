import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

// Same ApiCrmObjectType enum the entities endpoints validate (uppercase).
const objectType = z.enum(["ACCOUNT", "CONTACT", "DEAL", "LEAD"]).describe("CRM object type");

/**
 * The /v2/crm endpoints only cover integrations registered through Gong's
 * GENERIC CRM API (data pushed via API) — not native connectors like the
 * built-in Salesforce sync. Every call needs that integration's numeric id;
 * resolve it from gong_get_crm_integrations, with a clear error when the org
 * has none (the common case for native-connector orgs).
 */
async function resolveIntegrationId(client: GongClient, given?: string): Promise<string> {
  if (given) return given;
  const { integrations } = await client.getCrmIntegrations() as
    { integrations?: Array<{ integrationId?: string | number; id?: string | number; name?: string }> };
  const all = (integrations ?? []).map((i) => ({ id: String(i.integrationId ?? i.id), name: i.name }));
  if (all.length === 1) return all[0].id;
  if (all.length === 0) {
    throw new Error(
      "This org has no generic-CRM API integration registered (gong_get_crm_integrations returned none). " +
      "These endpoints only cover CRM data pushed via the Gong CRM API — native connectors like the " +
      "built-in Salesforce sync are not accessible here. For CRM context on calls, use gong_find_calls " +
      "with an account query or gong_call_summary instead."
    );
  }
  const list = all.map((i) => `"${i.name}"=${i.id}`).join(", ");
  throw new Error(`integrationId is required — this org has ${all.length} CRM integrations: ${list}`);
}

export function registerCrmTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_get_crm_entities",
    "Get CRM entity records pushed into Gong via the generic CRM API, by object ids. Only works for orgs " +
      "using the CRM push API — for CRM context on calls, prefer gong_find_calls or gong_call_summary.",
    {
      objectType,
      objectIds: z.array(z.string()).describe("CRM object ids to fetch"),
      integrationId: z.string().optional().describe("CRM integration id (auto-resolved when the org has exactly one)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.getCrmEntities({
        integrationId: await resolveIntegrationId(client, args.integrationId),
        objectType: args.objectType,
        objectIds: args.objectIds,
        cursor: args.cursor,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_entity_schema",
    "Get the field schema registered for a CRM object type in Gong's generic CRM API — shows which CRM " +
      "fields are mapped and synced.",
    {
      objectType,
      integrationId: z.string().optional().describe("CRM integration id (auto-resolved when the org has exactly one)"),
    },
    async (args) => {
      const data = await client.getCrmEntitySchema({
        integrationId: await resolveIntegrationId(client, args.integrationId),
        objectType: args.objectType,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_integrations",
    "List CRM integrations registered through Gong's generic CRM API. Returns an empty list when the org " +
      "only uses a native connector (e.g. the built-in Salesforce sync).",
    {},
    async () => {
      const data = await client.getCrmIntegrations();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_crm_request_status",
    "Check the status of an async CRM data ingestion request submitted via the generic CRM API.",
    {
      clientRequestId: z.string().describe("The client request ID returned from a CRM upsert call"),
      integrationId: z.string().optional().describe("CRM integration id (auto-resolved when the org has exactly one)"),
    },
    async (args) => {
      const data = await client.getCrmRequestStatus({
        integrationId: await resolveIntegrationId(client, args.integrationId),
        clientRequestId: args.clientRequestId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
