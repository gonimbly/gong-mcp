import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startOAuthFlow } from "../gong/oauth.js";
import { loadTokens, clearTokens, hasLegacyCredentials } from "../gong/tokenStore.js";

export function registerConfigureTool(server: McpServer) {
  server.tool(
    "gong_login",
    "Connect your Gong account via OAuth. Opens a browser window for you to sign in. Run this first before using any other Gong tools.",
    {},
    async () => {
      try {
        await startOAuthFlow();
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Login failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }

      try {
        const tokens = await loadTokens();
        if (!tokens) throw new Error("Tokens not found after login");
        const res = await fetch("https://api.gong.io/v2/workspaces", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!res.ok) {
          return {
            content: [{
              type: "text" as const,
              text: `Logged in but the API returned HTTP ${res.status}. Try gong_whoami to check your connection.`,
            }],
          };
        }
      } catch {
        // Non-fatal — tokens were saved, API check is best-effort
      }

      return {
        content: [{
          type: "text" as const,
          text: "Connected to Gong! All Gong tools are now ready to use.",
        }],
      };
    }
  );

  server.tool(
    "gong_logout",
    "Disconnect your Gong account and clear all stored OAuth tokens.",
    {},
    async () => {
      await clearTokens();
      return {
        content: [{
          type: "text" as const,
          text: "Logged out of Gong. Run gong_login to reconnect.",
        }],
      };
    }
  );

  server.tool(
    "gong_whoami",
    "Check the current Gong authentication status and token validity.",
    {},
    async () => {
      const tokens = await loadTokens();

      if (hasLegacyCredentials() && !tokens) {
        return {
          content: [{
            type: "text" as const,
            text: "Your Gong account is configured with old API key authentication. Run gong_login to upgrade to OAuth.",
          }],
        };
      }

      if (!tokens) {
        return {
          content: [{
            type: "text" as const,
            text: "Not connected. Run gong_login to connect your Gong account.",
          }],
        };
      }

      const expiresIn = tokens.expiresAt - Date.now();
      const expiryLabel =
        expiresIn < 0 ? "expired (will auto-refresh on next request)" :
        expiresIn < 5 * 60 * 1000 ? "expiring soon (will auto-refresh on next request)" :
        `expires in ${Math.round(expiresIn / 60000)} minutes`;

      try {
        const res = await fetch("https://api.gong.io/v2/workspaces", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (res.ok) {
          return {
            content: [{
              type: "text" as const,
              text: `Connected to Gong. Token: ${expiryLabel}.`,
            }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Token found but API returned HTTP ${res.status}. Token: ${expiryLabel}. Try running gong_login again.`,
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
