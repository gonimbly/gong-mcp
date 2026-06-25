import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { aiEntitiesEnabled } from "./featureFlags.js";

afterEach(() => {
  delete process.env.GONG_ENABLE_AI_ENTITIES;
});

// The whole credit kill-switch rests on this parse being strict and fail-safe:
// anything that is not exactly "true" must leave the paid AI endpoints DISABLED,
// so a typo or a truthy-looking value can never silently start spending credits.
describe("aiEntitiesEnabled — strict, fail-safe flag parsing", () => {
  test("unset → disabled", () => {
    delete process.env.GONG_ENABLE_AI_ENTITIES;
    assert.equal(aiEntitiesEnabled(), false);
  });

  test('exactly "true" → enabled', () => {
    process.env.GONG_ENABLE_AI_ENTITIES = "true";
    assert.equal(aiEntitiesEnabled(), true);
  });

  test("truthy-looking near-misses all stay DISABLED (fail safe)", () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", " true ", "true ", ""]) {
      process.env.GONG_ENABLE_AI_ENTITIES = v;
      assert.equal(aiEntitiesEnabled(), false, `${JSON.stringify(v)} must NOT enable paid endpoints`);
    }
  });
});
