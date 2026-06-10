#!/usr/bin/env node
/**
 * Remote MCP gateway (Phase 1).
 *
 * Claude connects here over Streamable HTTP. Users authenticate via Google OIDC
 * (restricted to the company domain + a pilot allowlist). The org-wide Gong
 * credential lives only in this process's environment — it is never sent to
 * clients. Per-user data filtering lands in Phase 2; until then, access is
 * limited to the GONG_ALLOWED_EMAILS pilot allowlist.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { GoogleOAuthProvider, loadGatewayConfig } from "./auth/googleProvider.js";
import { GongClient } from "./gong/client.js";
import { ScopedGongClient, type GatewayRole } from "./gong/scopedClient.js";
import { resolveGongIdentity, type GongIdentity } from "./gong/identity.js";
import { registerCallTools } from "./tools/calls.js";
import { registerUserTools } from "./tools/users.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerCrmTools } from "./tools/crm.js";
import { registerFlowTools } from "./tools/flows.js";
import { registerMeetingTools } from "./tools/meetings.js";
import { registerPermissionTools } from "./tools/permissions.js";
import { registerDataPrivacyTools } from "./tools/dataprivacy.js";
import { registerLogTools } from "./tools/logs.js";

const SESSION_IDLE_TTL_MS = 8 * 60 * 60 * 1000; // matches access-token lifetime

// ── Startup validation ────────────────────────────────────────────────────────

const config = loadGatewayConfig();

if (!process.env.GONG_ACCESS_KEY || !process.env.GONG_ACCESS_KEY_SECRET) {
  if (process.env.GONG_DEV_KEYCHAIN_FALLBACK === "1") {
    console.error("[gateway] DEV MODE: using local keychain Gong credential — not for production");
  } else {
    throw new Error(
      "Server mode requires the org Gong credential via GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET env vars. " +
      "(For local development only, set GONG_DEV_KEYCHAIN_FALLBACK=1 to use the keychain token from gong_login.)"
    );
  }
}

const provider = new GoogleOAuthProvider(config);
const gongClient = new GongClient();

// ── Per-session state ─────────────────────────────────────────────────────────

interface Session {
  transport: StreamableHTTPServerTransport;
  email: string;
  identity: GongIdentity;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) {
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000).unref();

function buildServer(identity: GongIdentity, role: GatewayRole): McpServer {
  const server = new McpServer({ name: "gong-mcp", version: "0.4.0" });
  // Every tool call in this session goes through the policy layer bound to this user
  const client = new ScopedGongClient(identity, role);

  server.tool(
    "gong_whoami",
    "Show who is connected to the Gong MCP gateway, their Gong identity and access level.",
    {},
    async () => ({
      content: [{
        type: "text" as const,
        text:
          `Connected as ${identity.email} (Gong user ${identity.userId}${identity.fullName ? `, ${identity.fullName}` : ""}). ` +
          (role === "admin"
            ? "Access level: admin (org-wide data)."
            : "Access level: member — calls and stats are limited to your own activity."),
      }],
    })
  );

  registerCallTools(server, client);
  registerUserTools(server, client);
  registerStatsTools(server, client);
  registerEntityTools(server, client);
  registerSettingsTools(server, client);
  registerLibraryTools(server, client);
  registerCrmTools(server, client);
  registerFlowTools(server, client);
  registerMeetingTools(server, client);
  registerPermissionTools(server, client);
  registerDataPrivacyTools(server, client);
  registerLogTools(server, client);
  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
// We always run behind a TLS-terminating proxy (cloudflared locally, Render in prod)
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

// CORS for browser-based MCP clients
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// OAuth authorization server endpoints (metadata, DCR, authorize, token)
app.use(mcpAuthRouter({
  provider,
  issuerUrl: new URL(config.baseUrl),
  resourceServerUrl: new URL(`${config.baseUrl}/mcp`),
  resourceName: "Gong MCP",
  scopesSupported: ["gong"],
}));

app.get("/auth/google/callback", (req, res) => {
  provider.handleGoogleCallback(req, res).catch((err) => {
    console.error("[gateway] Google callback error:", err);
    if (!res.headersSent) res.status(500).send("Internal error during sign-in.");
  });
});

const bearer = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${config.baseUrl}/mcp`)),
});

// ── MCP endpoint ──────────────────────────────────────────────────────────────

app.post("/mcp", bearer, async (req, res) => {
  try {
    const email = (req.auth?.extra?.email as string | undefined)?.toLowerCase();
    if (!email) return res.status(401).json({ error: "No identity on token" });

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return res.status(404).json({ error: "Unknown session" });
      if (session.email !== email) return res.status(403).json({ error: "Session belongs to another user" });
      session.lastSeen = Date.now();
      return await session.transport.handleRequest(req, res, req.body);
    }

    // New session — must be an initialize request
    const identity = await resolveGongIdentity(gongClient, email);
    if (!identity) {
      console.error(`[gateway] ${email} authenticated but has no Gong account`);
      return res.status(403).json({ error: `No Gong account found for ${email}` });
    }

    const role: GatewayRole = config.adminEmails.has(email) ? "admin" : "member";
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, email, identity, lastSeen: Date.now() });
        console.error(`[gateway] Session ${id} started for ${email} (Gong user ${identity.userId}, role ${role})`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    const server = buildServer(identity, role);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[gateway] MCP request error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

const routeExisting = async (req: express.Request, res: express.Response) => {
  const email = (req.auth?.extra?.email as string | undefined)?.toLowerCase();
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) return res.status(404).json({ error: "Unknown session" });
  if (session.email !== email) return res.status(403).json({ error: "Session belongs to another user" });
  session.lastSeen = Date.now();
  await session.transport.handleRequest(req, res);
};

app.get("/mcp", bearer, (req, res) => { routeExisting(req, res).catch((err) => {
  console.error("[gateway] MCP GET error:", err);
  if (!res.headersSent) res.status(500).end();
}); });

app.delete("/mcp", bearer, (req, res) => { routeExisting(req, res).catch((err) => {
  console.error("[gateway] MCP DELETE error:", err);
  if (!res.headersSent) res.status(500).end();
}); });

// ── Start ─────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.error(`[gateway] Gong MCP gateway listening on :${port}`);
  console.error(`[gateway] MCP endpoint: ${config.baseUrl}/mcp`);
  console.error(`[gateway] Pilot allowlist: ${[...config.allowedEmails].join(", ")}`);
});
