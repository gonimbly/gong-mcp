import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import { defaultWorkspaceId } from "./workspace.js";
import { aiEntitiesEnabled } from "../utils/featureFlags.js";

// The ask-entity/get-brief endpoints only support these fixed windows —
// arbitrary date ranges are rejected (verified live 2026-06-12).
const timePeriod = z.enum(["THIS_WEEK", "THIS_MONTH", "THIS_QUARTER", "THIS_YEAR"]).optional()
  .describe("Analysis window — one of the four supported periods (default THIS_MONTH; arbitrary date ranges are NOT supported)");

export function registerEntityTools(server: McpServer, client: GongClient) {
  const askAccount = server.tool(
    "gong_ask_account",
    [
      "Answer a free-text, natural-language question about a single CRM account by analyzing Gong call activity within a time window.",
      "Use for: targeted insights like objections, risks, stakeholder concerns, competitive mentions, next steps.",
      "Do NOT use for: cross-account analytics, fetching raw transcripts, or multi-category structured overviews — use gong_generate_brief for those.",
    ].join(" "),
    {
      workspaceId: z.string().optional().describe("Gong workspace ID (auto-resolved when the org has exactly one)"),
      crmAccountId: z.string().describe("CRM account ID (e.g. Salesforce Account ID — find it in the `crmRefs` Account objectId returned by gong_find_calls or gong_call_summary)"),
      timePeriod,
      question: z.string().describe('Natural-language question, e.g. "What are the main objections raised by the prospect?"'),
    },
    async (args) => {
      const data = await client.askAccount({
        workspaceId: args.workspaceId ?? await defaultWorkspaceId(client),
        crmAccountId: args.crmAccountId,
        timePeriod: args.timePeriod ?? "THIS_MONTH",
        question: args.question,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  const askDeal = server.tool(
    "gong_ask_deal",
    [
      "Answer a free-text, natural-language question about a single CRM deal or opportunity by analyzing Gong call activity within a time window.",
      "Use for: understanding deal progress, closure blockers, decision-maker concerns, or agreed-upon next steps.",
      "Do NOT use for: cross-deal analytics, raw activity lists, or broad summaries — use gong_generate_brief for those.",
    ].join(" "),
    {
      workspaceId: z.string().optional().describe("Gong workspace ID (auto-resolved when the org has exactly one)"),
      crmDealId: z.string().describe("CRM deal/opportunity ID (e.g. Salesforce Opportunity ID — find it in the `crmRefs` Opportunity objectId returned by gong_call_summary or gong_find_calls)"),
      timePeriod,
      question: z.string().describe('Natural-language question, e.g. "What are the main blockers preventing this deal from closing?"'),
    },
    async (args) => {
      const data = await client.askDeal({
        workspaceId: args.workspaceId ?? await defaultWorkspaceId(client),
        crmDealId: args.crmDealId,
        timePeriod: args.timePeriod ?? "THIS_MONTH",
        question: args.question,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  const generateBrief = server.tool(
    "gong_generate_brief",
    [
      "Generate a comprehensive, multi-category structured summary for an account, deal, contact, or lead — covering themes, stakeholders, and risks.",
      "Use for: account or deal reviews, executive briefings, handover documents.",
      "Do NOT use for: answering a targeted question — use gong_ask_account or gong_ask_deal for that.",
      "The brief template must already be PUBLISHED in Gong (Settings → Briefs); the API rejects unknown names.",
    ].join(" "),
    {
      workspaceId: z.string().optional().describe("Gong workspace ID (auto-resolved when the org has exactly one)"),
      briefName: z.string().describe("Name of a PUBLISHED brief template configured in Gong — not a free-text label"),
      crmEntityType: z.enum(["ACCOUNT", "DEAL", "CONTACT", "LEAD"]).describe("Type of CRM entity"),
      crmEntityId: z.string().describe("CRM entity ID (account, deal, or contact ID from your CRM)"),
      timePeriod,
    },
    async (args) => {
      const data = await client.generateBrief({
        workspaceId: args.workspaceId ?? await defaultWorkspaceId(client),
        briefName: args.briefName,
        crmEntityType: args.crmEntityType,
        crmEntityId: args.crmEntityId,
        timePeriod: args.timePeriod ?? "THIS_MONTH",
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // These three tools route to Gong's paid AI credit endpoints
  // (/v2/entities/ask-entity, /v2/entities/get-brief). Unless explicitly enabled,
  // disable them: the MCP SDK then omits them from tools/list (new clients never
  // see them) and answers any stale by-name call — e.g. from a previous skill
  // version that still has them cached — with a clear "Tool <name> disabled" error
  // instead of spending a credit. The request-layer guard in GongClient is the hard
  // backstop that guarantees no paid request ever leaves the process. See
  // aiEntitiesEnabled().
  if (!aiEntitiesEnabled()) {
    for (const tool of [askAccount, askDeal, generateBrief]) tool.disable();
  }
}
