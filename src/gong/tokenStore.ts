import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

const KEYCHAIN_SERVICE = "gong-mcp";
const KEYCHAIN_ACCOUNT = "oauth-tokens";
const TOKENS_FILE = path.join(os.homedir(), ".gong-mcp", "tokens.json");
const LEGACY_CREDENTIALS_PATH = path.join(os.homedir(), ".gong-mcp", "credentials.json");

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  clientId: string;
  // clientSecret intentionally absent — read from process.env.GONG_OAUTH_CLIENT_SECRET at refresh time
}

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
};

// undefined = not yet attempted; null = unavailable (headless/CI)
let _entry: KeyringEntry | null | undefined = undefined;

async function getKeychainEntry(): Promise<KeyringEntry | null> {
  if (_entry !== undefined) return _entry;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    _entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  } catch {
    console.error(
      "[gong-mcp] OS keychain unavailable (on Linux: install gnome-keyring or pass). " +
        "Tokens will be stored in " + TOKENS_FILE
    );
    _entry = null;
  }
  return _entry;
}

function parseTokenBlob(raw: string): OAuthTokens | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof data.accessToken === "string" &&
      typeof data.refreshToken === "string" &&
      typeof data.expiresAt === "number"
    ) {
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        tokenType: typeof data.tokenType === "string" ? data.tokenType : "bearer",
        clientId: typeof data.clientId === "string" ? data.clientId : "",
        // clientSecret deliberately not extracted from blob
      };
    }
  } catch {}
  return null;
}

export async function loadTokens(): Promise<OAuthTokens | null> {
  const entry = await getKeychainEntry();

  if (entry) {
    try {
      const raw = entry.getPassword();
      if (raw) {
        const tokens = parseTokenBlob(raw);
        if (tokens) return tokens;
      }
    } catch (err) {
      console.error("[gong-mcp] Failed to read from keychain:", err);
    }
  }

  // Migrate from legacy plaintext file if present
  if (existsSync(TOKENS_FILE)) {
    try {
      const raw = readFileSync(TOKENS_FILE, "utf-8");
      const tokens = parseTokenBlob(raw); // strips clientSecret
      if (tokens) {
        if (!process.env.GONG_OAUTH_CLIENT_SECRET) {
          console.error(
            "[gong-mcp] Warning: GONG_OAUTH_CLIENT_SECRET is not set. Token refresh may fail. " +
              "Run gong-mcp-setup to reconfigure."
          );
        }
        if (entry) {
          try {
            entry.setPassword(JSON.stringify(tokens));
            // Only delete after confirmed write
            try { unlinkSync(TOKENS_FILE); } catch {}
          } catch (err) {
            console.error("[gong-mcp] Failed to migrate tokens to keychain:", err);
          }
        }
        return tokens;
      }
    } catch (err) {
      console.error("[gong-mcp] Failed to read legacy tokens file:", err);
    }
  }

  return null;
}

export async function saveTokens(tokens: OAuthTokens): Promise<void> {
  const entry = await getKeychainEntry();
  const payload = JSON.stringify(tokens);

  if (entry) {
    try {
      entry.setPassword(payload);
      return;
    } catch (err) {
      console.error("[gong-mcp] Failed to save tokens to keychain, falling back to file:", err);
    }
  }

  // File fallback when keychain is unavailable
  mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  writeFileSync(TOKENS_FILE, payload, { mode: 0o600 });
}

export async function clearTokens(): Promise<void> {
  const entry = await getKeychainEntry();

  if (entry) {
    try { entry.deletePassword(); } catch {}
  }

  // Also remove legacy file if it lingers
  try { unlinkSync(TOKENS_FILE); } catch {}
}

export function hasLegacyCredentials(): boolean {
  return existsSync(LEGACY_CREDENTIALS_PATH);
}
