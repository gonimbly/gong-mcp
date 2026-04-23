import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";

export function registerEntityTools(server: McpServer, client: GongClient) {
  server.tool(
    "gong_ask_account",
    [
      "Answer a free-text, natural-language question about a single CRM account by analyzing Gong call activity within a time window.",
      "Use for: targeted insights like objections, risks, stakeholder concerns, competitive mentions, next steps.",
      "Do NOT use for: cross-account analytics, fetching raw transcripts, or multi-category structured overviews — use gong_generate_brief for those.",
    ].join(" "),
    {
      workspaceId: z.string().describe("Gong workspace ID (found in Admin Center > Company > Workspaces, in the URL)"),
      crmAccountId: z.string().describe("CRM account ID (e.g. Salesforce Account ID)"),
      fromDateTime: z.string().describe("ISO 8601 start of the analysis window, e.g. 2024-01-01T00:00:00Z"),
      toDateTime: z.string().describe("ISO 8601 end of the analysis window, e.g. 2024-03-31T23:59:59Z"),
      question: z.string().describe('Natural-language question, e.g. "What are the main objections raised by the prospect?"'),
    },
    async (args) => {
      const data = await client.askAccount(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_ask_deal",
    [
      "Answer a free-text, natural-language question about a single CRM deal or opportunity by analyzing Gong call activity within a time window.",
      "Use for: understanding deal progress, closure blockers, decision-maker concerns, or agreed-upon next steps.",
      "Do NOT use for: cross-deal analytics, raw activity lists, or broad summaries — use gong_generate_brief for those.",
    ].join(" "),
    {
      workspaceId: z.string().describe("Gong workspace ID (found in Admin Center > Company > Workspaces, in the URL)"),
      crmDealId: z.string().describe("CRM deal/opportunity ID (e.g. Salesforce Opportunity ID)"),
      fromDateTime: z.string().describe("ISO 8601 start of the analysis window"),
      toDateTime: z.string().describe("ISO 8601 end of the analysis window"),
      question: z.string().describe('Natural-language question, e.g. "What are the main blockers preventing this deal from closing?"'),
    },
    async (args) => {
      const data = await client.askDeal(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_generate_brief",
    [
      "Generate a comprehensive, multi-category structured summary for an account, deal, or contact — covering themes, stakeholders, and risks.",
      "Use for: account or deal reviews, executive briefings, handover documents.",
      "Do NOT use for: answering a targeted question — use gong_ask_account or gong_ask_deal for that.",
    ].join(" "),
    {
      workspaceId: z.string().describe("Gong workspace ID"),
      briefName: z.string().describe('Label for this brief, e.g. "Q1 Account Review" or "Pre-call Prep"'),
      entityType: z.enum(["ACCOUNT", "DEAL", "CONTACT"]).describe("Type of CRM entity"),
      crmEntityId: z.string().describe("CRM entity ID (account, deal, or contact ID from your CRM)"),
      periodType: z.string().describe('Period granularity, e.g. "LAST_30_DAYS", "LAST_90_DAYS", or "CUSTOM" (use CUSTOM with fromDateTime/toDateTime)'),
      fromDateTime: z.string().describe("ISO 8601 start date (used when periodType is CUSTOM)"),
      toDateTime: z.string().describe("ISO 8601 end date (used when periodType is CUSTOM)"),
    },
    async (args) => {
      const data = await client.generateBrief(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
