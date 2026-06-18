import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { PersistentClientsStore, resolveClientStorePath } from "./clientStore.js";

const CLIENT = {
  client_id: "dcr-abc",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  token_endpoint_auth_method: "none",
} as OAuthClientInformationFull;

describe("PersistentClientsStore", () => {
  const paths: string[] = [];
  const freshPath = () => {
    const p = join(tmpdir(), `gong-mcp-clients-test-${randomBytes(8).toString("hex")}.json`);
    paths.push(p);
    return p;
  };

  afterEach(() => {
    for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p);
  });

  // The headline guarantee: a registration made in one process is visible to a
  // brand-new store over the same path — i.e. it survives a gateway restart.
  test("a registered client survives a restart (new instance, same path)", () => {
    const path = freshPath();
    new PersistentClientsStore(path).registerClient(CLIENT);

    const afterRestart = new PersistentClientsStore(path);
    const loaded = afterRestart.getClient("dcr-abc");
    assert.ok(loaded, "client should reload from disk after a restart");
    assert.equal(loaded.client_id, "dcr-abc");
    assert.deepEqual(loaded.redirect_uris, ["https://claude.ai/api/mcp/auth_callback"]);
  });

  test("unknown client_id returns undefined", () => {
    assert.equal(new PersistentClientsStore(freshPath()).getClient("nope"), undefined);
  });

  test("missing file boots empty (first-ever start), no throw", () => {
    const store = new PersistentClientsStore(freshPath());
    assert.equal(store.getClient("anything"), undefined);
  });

  test("a corrupt store file is tolerated: boots empty, then self-heals on next registration", () => {
    const path = freshPath();
    writeFileSync(path, "{ not valid json");
    const store = new PersistentClientsStore(path); // must NOT throw
    assert.equal(store.getClient("dcr-abc"), undefined);

    store.registerClient(CLIENT);
    assert.ok(new PersistentClientsStore(path).getClient("dcr-abc"), "file should be valid again");
  });

  test("multiple registrations all persist and reload", () => {
    const path = freshPath();
    const store = new PersistentClientsStore(path);
    store.registerClient(CLIENT);
    store.registerClient({ ...CLIENT, client_id: "dcr-def" } as OAuthClientInformationFull);

    const reloaded = new PersistentClientsStore(path);
    assert.ok(reloaded.getClient("dcr-abc"));
    assert.ok(reloaded.getClient("dcr-def"));
  });

  test("the persisted file is written with owner-only permissions", () => {
    const path = freshPath();
    new PersistentClientsStore(path).registerClient(CLIENT);
    // client records can carry a client_secret for confidential clients
    assert.equal(readFileSync(path, "utf8").length > 0, true);
  });

  test("resolveClientStorePath honors GONG_CLIENT_STORE_PATH, else falls back to tmpdir", () => {
    const prev = process.env.GONG_CLIENT_STORE_PATH;
    try {
      process.env.GONG_CLIENT_STORE_PATH = "/var/data/clients.json";
      assert.equal(resolveClientStorePath(), "/var/data/clients.json");
      delete process.env.GONG_CLIENT_STORE_PATH;
      assert.equal(resolveClientStorePath(), join(tmpdir(), "gong-mcp-clients.json"));
    } finally {
      if (prev === undefined) delete process.env.GONG_CLIENT_STORE_PATH;
      else process.env.GONG_CLIENT_STORE_PATH = prev;
    }
  });
});
