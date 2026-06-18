import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Where OAuth Dynamic Client Registrations are persisted. In production this points at
 * a Render persistent disk (GONG_CLIENT_STORE_PATH=/var/data/clients.json) so the
 * registrations outlive deploys and restarts; locally it falls back to the OS temp dir.
 */
export function resolveClientStorePath(): string {
  const fromEnv = process.env.GONG_CLIENT_STORE_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(tmpdir(), "gong-mcp-clients.json");
}

/**
 * A durable OAuthRegisteredClientsStore.
 *
 * Claude registers itself via Dynamic Client Registration; the SDK's /token endpoint
 * then authenticates that client (`clientsStore.getClient`) on every grant — including
 * the silent refresh — BEFORE it ever inspects the refresh token. If the registration
 * is lost on restart, refresh fails with `invalid_client` and the user has to manually
 * reconnect. So we write each registration through to disk and reload it on boot.
 *
 * Reads are served from an in-memory cache; only `registerClient` (rare — a brand-new
 * client connecting) touches the disk, via an atomic temp-file + rename.
 */
export class PersistentClientsStore implements OAuthRegisteredClientsStore {
  private readonly cache = new Map<string, OAuthClientInformationFull>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {
      // Directory likely already exists; a real write problem surfaces in persist().
    }
    if (!existsSync(this.filePath)) return; // first-ever boot
    try {
      const clients = JSON.parse(readFileSync(this.filePath, "utf8")) as OAuthClientInformationFull[];
      for (const client of clients) {
        if (client?.client_id) this.cache.set(client.client_id, client);
      }
    } catch (err) {
      // A corrupt store must never crash-loop the gateway. Start empty; the next
      // registerClient atomically overwrites the bad file.
      console.error(
        `[clientStore] Could not read ${this.filePath}; starting empty ` +
          `(will overwrite on next registration):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.cache.get(clientId);
  }

  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    this.cache.set(client.client_id, client);
    this.persist();
    return client;
  }

  /** Atomic write: serialize to a sibling temp file, then rename over the target. */
  private persist(): void {
    const data = JSON.stringify([...this.cache.values()]);
    const tmp = join(dirname(this.filePath), `.clients.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, data, { mode: 0o600 });
      renameSync(tmp, this.filePath);
    } catch (err) {
      // Degrade to in-memory rather than failing a live connection: the current process
      // keeps working; only a later restart would lose this one registration.
      console.error(
        `[clientStore] Failed to persist client registration to ${this.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}
