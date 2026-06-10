import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { signJwt, verifyJwt } from "./jwt.js";

const KEY = "unit-test-signing-key";

describe("jwt", () => {
  test("sign/verify roundtrip preserves claims", () => {
    const token = signJwt({ sub: "user@gonimbly.com", name: "User", typ: "access", client_id: "c1" }, KEY, 60);
    const payload = verifyJwt(token, KEY);
    assert.ok(payload);
    assert.equal(payload.sub, "user@gonimbly.com");
    assert.equal(payload.typ, "access");
    assert.equal(payload.client_id, "c1");
    assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  });

  test("expired token is rejected", () => {
    const token = signJwt({ sub: "user@gonimbly.com", typ: "access", client_id: "c1" }, KEY, -10);
    assert.equal(verifyJwt(token, KEY), null);
  });

  test("tampered payload is rejected", () => {
    const token = signJwt({ sub: "user@gonimbly.com", typ: "access", client_id: "c1" }, KEY, 60);
    const [h, body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString());
    forged.sub = "attacker@gonimbly.com";
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    assert.equal(verifyJwt(tampered, KEY), null);
  });

  test("wrong key is rejected", () => {
    const token = signJwt({ sub: "user@gonimbly.com", typ: "access", client_id: "c1" }, KEY, 60);
    assert.equal(verifyJwt(token, "other-key"), null);
  });

  test("garbage input is rejected", () => {
    assert.equal(verifyJwt("not-a-jwt", KEY), null);
    assert.equal(verifyJwt("a.b", KEY), null);
    assert.equal(verifyJwt("", KEY), null);
  });
});
