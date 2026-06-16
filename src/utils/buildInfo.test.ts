import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { buildLabel, SERVER_VERSION } = await import("./buildInfo.js");

describe("buildLabel", () => {
  test("shortens a full commit SHA to 7 chars", () => {
    assert.equal(buildLabel("8419e3d4f1a2b3c4d5e6f7", "0.6.0"), "v0.6.0 (8419e3d)");
  });

  test("falls back to 'dev' when commit is undefined/empty/whitespace", () => {
    assert.equal(buildLabel(undefined, "0.6.0"), "v0.6.0 (dev)");
    assert.equal(buildLabel("", "0.6.0"), "v0.6.0 (dev)");
    assert.equal(buildLabel("   ", "0.6.0"), "v0.6.0 (dev)");
  });

  test("defaults to SERVER_VERSION when no version passed", () => {
    assert.equal(buildLabel("abcdef0123"), `v${SERVER_VERSION} (abcdef0)`);
  });
});
