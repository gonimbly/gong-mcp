import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import { aggregateEntityContext } from "../gong/entityContext.js";

/**
 * gong_entity_context — credit-free alternative to the (disabled) paid AI tools
 * gong_ask_account / gong_ask_deal / gong_generate_brief. It gathers the recent
 * call activity for one CRM entity and returns it as a single context block; the
 * MCP client's own model then answers any question or writes a brief from it.
 * Registered unconditionally (it never touches Gong's metered AI endpoints).
 */
export function registerEntityContextTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_entity_context",
    [
      "Gather the recent Gong call activity for ONE CRM entity (account, deal, contact, or lead) into a single",
      "context block — call digests with outcome, brief, key points, next steps, topics, trackers, and participants",
      "— so you can answer questions or write a brief about it WITHOUT consuming paid Gong AI credits.",
      "Use this in place of gong_ask_account / gong_ask_deal / gong_generate_brief (which are disabled by default):",
      "call this tool, then answer the user's question from the returned calls yourself.",
      "For ACCOUNT/DEAL pass the Salesforce object id (from the `crmRefs` returned by gong_find_calls / gong_call_summary);",
      "for CONTACT/LEAD pass the person's email address.",
      "Gong has no server-side CRM filter, so this scans recent calls (up to maxPages×100) and can take 20–40s on busy accounts;",
      "coverage is recency-bounded — ALWAYS read the returned `note`/`coverage`, which flag when matched calls were capped or older calls were not scanned.",
    ].join(" "),
    {
      crmEntityType: z.enum(["ACCOUNT", "DEAL", "CONTACT", "LEAD"]).describe("Which kind of CRM entity entityRef identifies"),
      entityRef: z.string().describe(
        "ACCOUNT → Salesforce Account id; DEAL → Salesforce Opportunity id (both from the `crmRefs` objectId on a call). " +
        "CONTACT/LEAD → the person's email address (matched against call participants, external attendees included)."
      ),
      fromDateTime: z.string().optional().describe("ISO 8601 start of the window (default: 30 days ago)"),
      toDateTime: z.string().optional().describe("ISO 8601 end of the window (default: now)"),
      maxCalls: z.number().int().min(1).max(25).optional().describe("Most-recent calls to enrich into the context (default 10, max 25; capped at 5 when includeTranscripts is set)"),
      includeTranscripts: z.boolean().optional().describe("Attach speaker-attributed transcripts for each call (default false; uses far more tokens, so the call count is capped at 5)"),
      maxPages: z.number().int().min(1).max(20).optional().describe("Scan page budget, 100 calls each (default 8, max 20). Higher reaches further back on busy accounts but is slower; the coverage note flags when older calls were not scanned"),
      workspaceId: z.string().optional().describe("Restrict the scan to one workspace"),
    },
    async (args) => {
      const data = await aggregateEntityContext(client, {
        crmEntityType: args.crmEntityType,
        entityRef: args.entityRef,
        fromDateTime: args.fromDateTime,
        toDateTime: args.toDateTime,
        maxCalls: args.maxCalls,
        includeTranscripts: args.includeTranscripts,
        maxPages: args.maxPages,
        workspaceId: args.workspaceId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
