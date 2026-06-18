import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GoogleOAuthProvider, type GatewayConfig } from "./googleProvider.js";
import { signJwt } from "./jwt.js";

const SIGNING_KEY = "gateway-test-signing-key";

function makeConfig(): GatewayConfig {
  return {
    baseUrl: "https://gateway.test",
    googleClientId: "google-client",
    googleClientSecret: "google-secret",
    signingKey: SIGNING_KEY,
    allowedEmails: new Set(["member@gonimbly.com"]),
    adminEmails: new Set(),
    allowedDomain: "gonimbly.com",
  };
}

// Mirrors what Claude registers via Dynamic Client Registration (public client, PKCE).
const CLIENT = {
  client_id: "dcr-" + randomBytes(6).toString("hex"),
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  token_endpoint_auth_method: "none",
} as OAuthClientInformationFull;

describe("OAuth client registration survives a gateway restart", () => {
  let storePath: string;

  beforeEach(() => {
    storePath = join(tmpdir(), `gong-mcp-clients-${randomBytes(8).toString("hex")}.json`);
    process.env.GONG_CLIENT_STORE_PATH = storePath;
  });

  afterEach(() => {
    delete process.env.GONG_CLIENT_STORE_PATH;
    if (existsSync(storePath)) rmSync(storePath);
  });

  // This is the exact failure Jerry hit. After a restart, the SDK's /token endpoint
  // calls clientsStore.getClient(client_id) (via the authenticateClient middleware)
  // for the refresh_token grant, BEFORE the refresh token is ever inspected. If that
  // returns undefined the SDK throws invalid_client and Claude must be manually
  // reconnected. We drive that exact chain across a simulated restart.
  test("a client registered before a restart can still refresh after it", async () => {
    // --- process 1: Claude connects, registers via DCR, holds a 30-day refresh token ---
    const before = new GoogleOAuthProvider(makeConfig());
    await before.clientsStore.registerClient(CLIENT);
    const refreshToken = signJwt(
      { sub: "member@gonimbly.com", typ: "refresh", client_id: CLIENT.client_id },
      SIGNING_KEY,
      30 * 24 * 60 * 60,
    );

    // --- the gateway restarts: a brand-new process, brand-new provider + store ---
    const after = new GoogleOAuthProvider(makeConfig());

    // The step the SDK's /token path takes FIRST, before it looks at the refresh token:
    const client = await after.clientsStore.getClient(CLIENT.client_id);
    assert.ok(
      client,
      "getClient must still resolve the client after a restart — otherwise the SDK " +
        "throws invalid_client and the user has to manually reconnect",
    );

    // ...and the refresh itself yields fresh, valid tokens — i.e. silent reconnect works.
    const tokens = await after.exchangeRefreshToken(client, refreshToken);
    assert.ok(tokens.access_token, "refresh should mint a new access token");
    const info = await after.verifyAccessToken(tokens.access_token);
    assert.equal(info.extra?.email, "member@gonimbly.com");
  });
});
