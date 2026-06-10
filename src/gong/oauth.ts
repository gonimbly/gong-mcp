import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { saveTokens, type OAuthTokens } from "./tokenStore.js";

const AUTH_URL = "https://app.gong.io/oauth2/authorize";
const TOKEN_URL = "https://app.gong.io/oauth2/generate-customer-token";
const CALLBACK_PORT = 49201;
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

let inProgress = false;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// Uses execFile (not exec) to avoid shell injection from URL parameters
function openBrowser(url: string): void {
  if (process.platform === "darwin") {
    execFile("open", [url]);
  } else if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url]);
  } else {
    execFile("xdg-open", [url]);
  }
}

function basicAuthHeader(clientId: string, clientSecret?: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret ?? ""}`).toString("base64");
}

async function exchangeCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type ?? "Bearer",
    clientId: params.clientId,
    // clientSecret not stored — read from process.env at refresh time
  };
}

export async function refreshAccessToken(tokens: OAuthTokens): Promise<OAuthTokens> {
  // Read clientSecret from env at refresh time — never persisted in the token store
  const clientSecret = process.env.GONG_OAUTH_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(tokens.clientId, clientSecret),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token refresh failed (HTTP ${res.status}): ${text}. Run gong_login to reconnect.`
    );
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type ?? "Bearer",
    clientId: tokens.clientId,
  };
}

async function startCallbackServer(
  expectedState: string
): Promise<{ port: number; waitForCallback: Promise<string> }> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;

  const waitForCallback = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const html = (title: string, body: string) =>
      `<html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">` +
      `<h2>${title}</h2><p>${body}</p></body></html>`;

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(html("Authorization failed", `${error}<br>You can close this tab.`));
      server.close();
      rejectCode(new Error(`Authorization denied: ${error}`));
      return;
    }

    if (state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(html("Invalid state", "You can close this tab."));
      server.close();
      rejectCode(new Error("OAuth state mismatch"));
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(html("Missing code", "You can close this tab."));
      server.close();
      rejectCode(new Error("No authorization code received"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html("Connected to Gong!", "You can close this tab and return to Claude."));
    server.close();
    resolveCode(code);
  });

  return new Promise((resolveSetup, rejectSetup) => {
    server.on("error", rejectSetup);
    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      const timeout = setTimeout(() => {
        server.close();
        rejectCode(new Error("OAuth flow timed out. Run gong_login to try again."));
      }, FLOW_TIMEOUT_MS);
      timeout.unref();

      resolveSetup({ port: CALLBACK_PORT, waitForCallback });
    });
  });
}

export async function startOAuthFlow(): Promise<OAuthTokens> {
  if (inProgress) {
    throw new Error("OAuth flow already in progress. Check your browser.");
  }

  const clientId = process.env.GONG_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GONG_OAUTH_CLIENT_ID is not set. Register an OAuth app in Gong → Settings → API → OAuth Apps " +
      "and set GONG_OAUTH_CLIENT_ID in your MCP server environment."
    );
  }
  const clientSecret = process.env.GONG_OAUTH_CLIENT_SECRET;

  inProgress = true;
  try {
    const { verifier, challenge } = generatePKCE();
    const state = base64url(randomBytes(32));

    const { port, waitForCallback } = await startCallbackServer(state);
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    openBrowser(authUrl.toString());

    const code = await waitForCallback;
    const tokens = await exchangeCode({ code, redirectUri, codeVerifier: verifier, clientId, clientSecret });
    await saveTokens(tokens);
    return tokens;
  } finally {
    inProgress = false;
  }
}
