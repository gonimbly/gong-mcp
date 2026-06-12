import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GongClient } from "../gong/client.js";
import type { GongIdentity } from "../gong/identity.js";

export function registerFlowTools(server: McpServer, client: GongClient, identity?: GongIdentity) {
  // The flows API is owner-scoped: both list endpoints require an owner email
  // and 403 when that user has no Gong Engage license.
  const resolveOwner = (email: string | undefined, param: string): string => {
    const owner = email ?? identity?.email;
    if (!owner) {
      throw new Error(`${param} is required when no user identity is connected — flows are listed per owner.`);
    }
    return owner;
  };

  server.tool(
    "gong_list_flows",
    "List Gong Engage flows (sales sequences/cadences) owned by a user. Defaults to the connected user; " +
      "requires that user to have a Gong Engage license.",
    {
      flowOwnerEmail: z.string().optional().describe("Flow owner's email (default: the connected user)"),
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.listFlows({
        flowOwnerEmail: resolveOwner(args.flowOwnerEmail, "flowOwnerEmail"),
        workspaceId: args.workspaceId,
        cursor: args.cursor,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_list_flow_folders",
    "List the folders organizing a user's flows in Gong Engage. Defaults to the connected user; requires a " +
      "Gong Engage license.",
    {
      flowFolderOwnerEmail: z.string().optional().describe("Folder owner's email (default: the connected user)"),
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async (args) => {
      const data = await client.listFlowFolders({
        flowFolderOwnerEmail: resolveOwner(args.flowFolderOwnerEmail, "flowFolderOwnerEmail"),
        workspaceId: args.workspaceId,
        cursor: args.cursor,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_assign_flow_to_prospect",
    "Assign a prospect (contact) to a specific Gong Engage flow.",
    {
      flowId: z.string().describe("The flow ID to assign"),
      crmId: z.string().optional().describe("CRM contact/lead ID"),
      email: z.string().optional().describe("Prospect email address"),
      userId: z.string().optional().describe("Gong user ID of the rep who owns this prospect"),
    },
    async (args) => {
      const data = await client.assignFlowToProspect({
        flowId: args.flowId,
        crmId: args.crmId,
        email: args.email,
        userId: args.userId,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_bulk_assign_flows",
    "Bulk-assign multiple prospects to flows. Returns a request ID for async status polling.",
    {
      assignments: z
        .array(
          z.object({
            flowId: z.string(),
            crmId: z.string().optional(),
            email: z.string().optional(),
            userId: z.string().optional(),
          })
        )
        .describe("List of prospect-to-flow assignments"),
    },
    async (args) => {
      const data = await client.bulkAssignFlows({ assignments: args.assignments });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_get_bulk_assignment_status",
    "Check the status of a bulk flow assignment request.",
    {
      requestId: z.string().describe("The bulk assignment request ID"),
    },
    async (args) => {
      const data = await client.getBulkAssignmentStatus(args.requestId);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gong_unassign_flows_by_crm_id",
    "Remove a prospect from all flows using their CRM ID.",
    {
      crmIds: z.array(z.string()).describe("CRM contact/lead IDs to unassign from all flows"),
    },
    async (args) => {
      const data = await client.unassignFlowsByCrmId({ crmIds: args.crmIds });
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
