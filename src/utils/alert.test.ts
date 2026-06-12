import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendSlackAlert } from "./alert.js";

let fetchCalls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  fetchCalls = [];
  delete process.env.ALERT_SLACK_WEBHOOK_URL;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
});

describe("sendSlackAlert", () => {
  test("sends POST to webhook URL with message as text", async () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    sendSlackAlert("hello world");
    // yield to microtasks so the fire-and-forget fetch resolves
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://hooks.slack.com/test");
    const body = JSON.parse(fetchCalls[0].init.body as string);
    assert.equal(body.text, "hello world");
  });

  test("uses POST method", async () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    sendSlackAlert("msg");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetchCalls[0].init.method, "POST");
  });

  test("does not call fetch when webhook URL is unset", async () => {
    delete process.env.ALERT_SLACK_WEBHOOK_URL;
    sendSlackAlert("msg");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetchCalls.length, 0);
  });

  test("does not throw when fetch rejects", async () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    globalThis.fetch = (() => Promise.reject(new Error("network error"))) as typeof fetch;
    // Should not throw — alert is fire-and-forget
    assert.doesNotThrow(() => sendSlackAlert("msg"));
    await new Promise((r) => setTimeout(r, 0));
  });
});
