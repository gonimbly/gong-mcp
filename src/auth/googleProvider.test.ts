import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GoogleOAuthProvider, loadGatewayConfig, type GatewayConfig } from "./googleProvider.js";
import { signJwt } from "./jwt.js";

const SIGNING_KEY = "gateway-test-signing-key";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    baseUrl: "https://gateway.test",
    googleClientId: "google-client",
    googleClientSecret: "google-secret",
    signingKey: SIGNING_KEY,
    allowedEmails: new Set(["member@gonimbly.com", "admin@gonimbly.com"]),
    adminEmails: new Set(["admin@gonimbly.com"]),
    allowedDomain: "gonimbly.com",
    ...overrides,
  };
}

const CLIENT = { client_id: "c1", redirect_uris: ["http://localhost/cb"] } as OAuthClientInformationFull;

describe("loadGatewayConfig", () => {
  const BASE_ENV = {
    BASE_URL: "https://gateway.test",
    GOOGLE_OAUTH_CLIENT_ID: "g",
    GOOGLE_OAUTH_CLIENT_SECRET: "s",
    SESSION_SIGNING_KEY: "k",
    GONG_ALLOWED_EMAILS: "A@gonimbly.com, b@gonimbly.com",
  };

  beforeEach(() => {
    for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] = v;
    delete process.env.GONG_ADMIN_EMAILS;
    delete process.env.GONG_ALLOWED_DOMAIN;
  });

  test("parses and lowercases the allowlist", () => {
    const config = loadGatewayConfig();
    assert.ok(config.allowedEmails.has("a@gonimbly.com"));
    assert.ok(config.allowedEmails.has("b@gonimbly.com"));
    assert.equal(config.allowedDomain, "gonimbly.com");
  });

  test("rejects an admin who is not on the allowlist", () => {
    process.env.GONG_ADMIN_EMAILS = "intruder@gonimbly.com";
    assert.throws(() => loadGatewayConfig(), /not in GONG_ALLOWED_EMAILS/);
  });

  test("requires the allowlist to be present and non-empty", () => {
    delete process.env.GONG_ALLOWED_EMAILS;
    assert.throws(() => loadGatewayConfig(), /GONG_ALLOWED_EMAILS/);
    process.env.GONG_ALLOWED_EMAILS = " , ";
    assert.throws(() => loadGatewayConfig(), /at least one email/);
  });

  test("strips trailing slash from BASE_URL", () => {
    process.env.BASE_URL = "https://gateway.test/";
    assert.equal(loadGatewayConfig().baseUrl, "https://gateway.test");
  });
});

describe("verifyAccessToken", () => {
  const provider = new GoogleOAuthProvider(makeConfig());

  test("accepts a valid access token and exposes the identity", async () => {
    const token = signJwt({ sub: "member@gonimbly.com", typ: "access", client_id: "c1" }, SIGNING_KEY, 60);
    const info = await provider.verifyAccessToken(token);
    assert.equal(info.extra?.email, "member@gonimbly.com");
    assert.equal(info.clientId, "c1");
  });

  test("rejects a refresh token used as an access token", async () => {
    const token = signJwt({ sub: "member@gonimbly.com", typ: "refresh", client_id: "c1" }, SIGNING_KEY, 60);
    await assert.rejects(provider.verifyAccessToken(token));
  });

  test("rejects a token signed with a different key", async () => {
    const token = signJwt({ sub: "member@gonimbly.com", typ: "access", client_id: "c1" }, "evil-key", 60);
    await assert.rejects(provider.verifyAccessToken(token));
  });
});

describe("exchangeRefreshToken", () => {
  const provider = new GoogleOAuthProvider(makeConfig());

  test("issues fresh tokens for an allowlisted user", async () => {
    const refresh = signJwt({ sub: "member@gonimbly.com", typ: "refresh", client_id: "c1" }, SIGNING_KEY, 600);
    const tokens = await provider.exchangeRefreshToken(CLIENT, refresh);
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
    const info = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(info.extra?.email, "member@gonimbly.com");
  });

  test("refuses refresh for a user removed from the allowlist", async () => {
    const refresh = signJwt({ sub: "removed@gonimbly.com", typ: "refresh", client_id: "c1" }, SIGNING_KEY, 600);
    await assert.rejects(provider.exchangeRefreshToken(CLIENT, refresh), /no longer authorized/);
  });

  test("refuses a refresh token bound to a different client", async () => {
    const refresh = signJwt({ sub: "member@gonimbly.com", typ: "refresh", client_id: "other-client" }, SIGNING_KEY, 600);
    await assert.rejects(provider.exchangeRefreshToken(CLIENT, refresh));
  });

  test("refuses an access token used as a refresh token", async () => {
    const access = signJwt({ sub: "member@gonimbly.com", typ: "access", client_id: "c1" }, SIGNING_KEY, 600);
    await assert.rejects(provider.exchangeRefreshToken(CLIENT, access));
  });
});

describe("authorization codes", () => {
  const provider = new GoogleOAuthProvider(makeConfig());

  test("unknown authorization code is rejected", async () => {
    await assert.rejects(provider.challengeForAuthorizationCode(CLIENT, "no-such-code"));
    await assert.rejects(provider.exchangeAuthorizationCode(CLIENT, "no-such-code"));
  });
});
