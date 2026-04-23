import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { saveCredentials, loadCredentials } from "../gong/credentials.js";

export function registerConfigureTool(server: McpServer) {
  server.tool(
    "gong_setup",
    "Configure Gong API credentials. Run this first if Gong tools return an authentication error. Get your Access Key and Secret from Gong → Settings → API → Access Keys (requires Technical Administrator role).",
    {
      accessKey: z.string().describe("Gong API Access Key"),
      accessKeySecret: z.string().describe("Gong API Access Key Secret"),
    },
    async (args) => {
      // Validate before saving
      const encoded = Buffer.from(`${args.accessKey}:${args.accessKeySecret}`).toString("base64");
      try {
        const res = await fetch("https://api.gong.io/v2/workspaces", {
          headers: { Authorization: `Basic ${encoded}` },
        });
        if (!res.ok) {
          return {
            content: [{
              type: "text" as const,
              text: `Invalid credentials (HTTP ${res.status}). Double-check your Access Key and Secret in Gong → Settings → API.`,
            }],
          };
        }
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Could not reach the Gong API: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }

      saveCredentials({ accessKey: args.accessKey, accessKeySecret: args.accessKeySecret });

      return {
        content: [{
          type: "text" as const,
          text: "Gong credentials saved and validated. All Gong tools are now ready to use.",
        }],
      };
    }
  );

  server.tool(
    "gong_whoami",
    "Check which Gong credentials are currently configured and whether they are valid.",
    {},
    async () => {
      const creds = loadCredentials();
      if (!creds) {
        return {
          content: [{
            type: "text" as const,
            text: "No credentials configured. Run gong_setup to connect your Gong account.",
          }],
        };
      }

      const encoded = Buffer.from(`${creds.accessKey}:${creds.accessKeySecret}`).toString("base64");
      try {
        const res = await fetch("https://api.gong.io/v2/workspaces", {
          headers: { Authorization: `Basic ${encoded}` },
        });
        if (res.ok) {
          const masked = `${creds.accessKey.slice(0, 4)}${"*".repeat(creds.accessKey.length - 4)}`;
          return {
            content: [{
              type: "text" as const,
              text: `Connected. Access Key: ${masked}`,
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Credentials found but invalid (HTTP ${res.status}). Run gong_setup to update them.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Could not reach Gong API: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );
}
