import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { signJwt, verifyJwt } from "./jwt.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const ACCESS_TOKEN_TTL_SEC = 8 * 60 * 60;        // 8 hours
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;      // 10 minutes
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;          // 5 minutes

export interface GatewayConfig {
  baseUrl: string;             // public URL of this gateway, no trailing slash
  googleClientId: string;
  googleClientSecret: string;
  signingKey: string;
  allowedEmails: Set<string>;  // lowercase
  adminEmails: Set<string>;    // lowercase subset of allowedEmails with admin role
  allowedDomain: string;       // e.g. "gonimbly.com"
}

export function loadGatewayConfig(): GatewayConfig {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  };

  const allowedEmailsRaw = required("GONG_ALLOWED_EMAILS");
  const allowedEmails = new Set(
    allowedEmailsRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  if (allowedEmails.size === 0) {
    throw new Error("GONG_ALLOWED_EMAILS must contain at least one email (comma-separated).");
  }

  const adminEmails = new Set(
    (process.env.GONG_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  for (const admin of adminEmails) {
    if (!allowedEmails.has(admin)) {
      throw new Error(`GONG_ADMIN_EMAILS contains ${admin}, which is not in GONG_ALLOWED_EMAILS.`);
    }
  }

  return {
    baseUrl: required("BASE_URL").replace(/\/$/, ""),
    googleClientId: required("GOOGLE_OAUTH_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    signingKey: required("SESSION_SIGNING_KEY"),
    allowedEmails,
    adminEmails,
    allowedDomain: (process.env.GONG_ALLOWED_DOMAIN ?? "gonimbly.com").toLowerCase(),
  };
}

interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  clientState?: string;
  expiresAt: number;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  email: string;
  name?: string;
  expiresAt: number;
}

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  registerClient(client: OAuthClientInformationFull) {
    this.clients.set(client.client_id, client);
    return client;
  }
}

export class GoogleOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private pendingAuth = new Map<string, PendingAuth>();
  private issuedCodes = new Map<string, IssuedCode>();

  constructor(private readonly config: GatewayConfig) {}

  private googleRedirectUri(): string {
    return `${this.config.baseUrl}/auth/google/callback`;
  }

  private isAllowed(email: string): boolean {
    const lower = email.toLowerCase();
    const domain = lower.split("@")[1] ?? "";
    return domain === this.config.allowedDomain && this.config.allowedEmails.has(lower);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pendingAuth) if (v.expiresAt < now) this.pendingAuth.delete(k);
    for (const [k, v] of this.issuedCodes) if (v.expiresAt < now) this.issuedCodes.delete(k);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.sweep();
    const gstate = randomBytes(32).toString("base64url");
    this.pendingAuth.set(gstate, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      clientState: params.state,
      expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", this.config.googleClientId);
    url.searchParams.set("redirect_uri", this.googleRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", gstate);
    url.searchParams.set("hd", this.config.allowedDomain);
    url.searchParams.set("prompt", "select_account");
    res.redirect(url.toString());
  }

  /** Express handler for GET /auth/google/callback */
  async handleGoogleCallback(req: Request, res: Response): Promise<void> {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const fail = (status: number, msg: string) => {
      res.status(status).send(
        `<html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">` +
        `<h2>Sign-in failed</h2><p>${msg}</p></body></html>`
      );
    };

    if (error) return fail(400, `Google returned: ${error}`);
    if (!code || !state) return fail(400, "Missing code or state.");

    const pending = this.pendingAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      return fail(400, "Sign-in session expired. Please try connecting again.");
    }
    this.pendingAuth.delete(state);

    // Exchange the Google code
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: this.googleRedirectUri(),
      }).toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      console.error("[gateway] Google token exchange failed:", tokenRes.status, text);
      return fail(502, "Could not complete Google sign-in. Please try again.");
    }

    const tokenData = await tokenRes.json() as { id_token?: string };
    if (!tokenData.id_token) return fail(502, "Google response missing id_token.");

    // The id_token came directly from Google over TLS — decode without signature verification
    let claims: { email?: string; email_verified?: boolean; hd?: string; name?: string; aud?: string };
    try {
      const body = tokenData.id_token.split(".")[1];
      claims = JSON.parse(Buffer.from(body, "base64url").toString());
    } catch {
      return fail(502, "Could not parse Google identity.");
    }

    if (claims.aud !== this.config.googleClientId) return fail(403, "Identity token audience mismatch.");
    if (!claims.email || claims.email_verified !== true) return fail(403, "Email not verified.");
    if (!this.isAllowed(claims.email)) {
      console.error(`[gateway] Denied login for ${claims.email} (not on allowlist)`);
      return fail(403,
        `${claims.email} is not authorized to use the Gong MCP pilot. ` +
        `Ask the administrator to add you to the allowlist.`
      );
    }

    // Mint our authorization code and send the user back to the MCP client
    const ourCode = randomBytes(32).toString("base64url");
    this.issuedCodes.set(ourCode, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      email: claims.email.toLowerCase(),
      name: claims.name,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", ourCode);
    if (pending.clientState) redirect.searchParams.set("state", pending.clientState);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const issued = this.issuedCodes.get(authorizationCode);
    if (!issued || issued.clientId !== client.client_id || issued.expiresAt < Date.now()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return issued.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const issued = this.issuedCodes.get(authorizationCode);
    if (!issued || issued.clientId !== client.client_id || issued.expiresAt < Date.now()) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    if (redirectUri && redirectUri !== issued.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    this.issuedCodes.delete(authorizationCode);
    return this.issueTokens(client.client_id, issued.email, issued.name);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const payload = verifyJwt(refreshToken, this.config.signingKey);
    if (!payload || payload.typ !== "refresh" || payload.client_id !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    // Re-check the allowlist on every refresh so removals take effect within the access-token TTL
    if (!this.isAllowed(payload.sub)) {
      throw new InvalidGrantError("User is no longer authorized");
    }
    return this.issueTokens(client.client_id, payload.sub, payload.name as string | undefined);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = verifyJwt(token, this.config.signingKey);
    if (!payload || payload.typ !== "access") {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return {
      token,
      clientId: payload.client_id,
      scopes: ["gong"],
      expiresAt: payload.exp,
      extra: { email: payload.sub, name: payload.name },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, _request: OAuthTokenRevocationRequest): Promise<void> {
    // Tokens are stateless JWTs; revocation happens by removing the user from the allowlist,
    // which takes effect at the next refresh (access tokens live max 8h).
  }

  private issueTokens(clientId: string, email: string, name?: string): OAuthTokens {
    return {
      access_token: signJwt({ sub: email, name, typ: "access", client_id: clientId }, this.config.signingKey, ACCESS_TOKEN_TTL_SEC),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: signJwt({ sub: email, name, typ: "refresh", client_id: clientId }, this.config.signingKey, REFRESH_TOKEN_TTL_SEC),
      scope: "gong",
    };
  }
}
