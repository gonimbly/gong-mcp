import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

const TOKENS_PATH = path.join(os.homedir(), ".gong-mcp", "tokens.json");
const LEGACY_CREDENTIALS_PATH = path.join(os.homedir(), ".gong-mcp", "credentials.json");

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;      // Unix ms: Date.now() + expires_in * 1000
  tokenType: string;
  clientId: string;
  clientSecret?: string;
}

export function loadTokens(): OAuthTokens | null {
  try {
    const data = JSON.parse(readFileSync(TOKENS_PATH, "utf-8")) as OAuthTokens;
    if (data.accessToken && data.refreshToken && data.expiresAt) return data;
  } catch {
    // File doesn't exist yet
  }
  return null;
}

export function saveTokens(tokens: OAuthTokens): void {
  mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  try {
    unlinkSync(TOKENS_PATH);
  } catch {
    // Already gone
  }
}

export function hasLegacyCredentials(): boolean {
  return existsSync(LEGACY_CREDENTIALS_PATH);
}
