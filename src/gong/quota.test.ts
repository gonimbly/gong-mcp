import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { quotaTracker } from "./quota.js";

// Access private fields for test setup
const t = quotaTracker as any;

let fetchCalls: { url: string; body: any }[] = [];

function reset(opts: { count?: number; date?: string; alerted?: boolean } = {}) {
  t.count = opts.count ?? 0;
  t.date = opts.date ?? new Date().toISOString().slice(0, 10);
  t.alerted = opts.alerted ?? false;
}

describe("DailyQuotaTracker", () => {
  beforeEach(() => {
    fetchCalls = [];
    delete process.env.ALERT_SLACK_WEBHOOK_URL;
    reset();
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
  });

  test("increments count on each call", () => {
    quotaTracker.increment();
    quotaTracker.increment();
    quotaTracker.increment();
    assert.equal(quotaTracker.getStatus().count, 3);
  });

  test("isOverLimit returns false below 50k", () => {
    reset({ count: 49_999 });
    assert.equal(quotaTracker.isOverLimit(), false);
  });

  test("isOverLimit returns true at 50k", () => {
    reset({ count: 50_000 });
    assert.equal(quotaTracker.isOverLimit(), true);
  });

  test("isOverLimit returns true above 50k", () => {
    reset({ count: 50_001 });
    assert.equal(quotaTracker.isOverLimit(), true);
  });

  test("rolls over counter when date changes", () => {
    reset({ count: 1_000, date: "2020-01-01" });
    quotaTracker.increment(); // triggers rollover since stored date is old
    assert.equal(quotaTracker.getStatus().count, 1);
    assert.notEqual(quotaTracker.getStatus().date, "2020-01-01");
  });

  test("isOverLimit resets to false after date rollover", () => {
    reset({ count: 50_000, date: "2020-01-01" });
    assert.equal(quotaTracker.isOverLimit(), false); // rolled over → count is now 0
    assert.equal(quotaTracker.getStatus().count, 0);
  });

  test("alert fires once when crossing 75% threshold", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 37_499 });
    quotaTracker.increment(); // crosses 37,500
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://hooks.slack.com/test");
  });

  test("alert does not re-fire after already triggered", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 37_500, alerted: true });
    quotaTracker.increment();
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 0);
  });

  test("alert fires again after a day rollover", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    // Simulate: already alerted in a prior day
    reset({ count: 37_500, alerted: true, date: "2020-01-01" });
    // Trigger rollover — resets count, alerted, and date
    quotaTracker.isOverLimit();
    assert.equal(t.alerted, false);
    assert.equal(t.count, 0);
    // Fast-forward to just below threshold in the new day
    t.count = 37_499;
    quotaTracker.increment(); // should trigger alert again
    assert.equal(fetchCalls.length, 1);
  });

  test("no Slack fetch when webhook env var is unset", () => {
    delete process.env.ALERT_SLACK_WEBHOOK_URL;
    reset({ count: 37_499 });
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 0);
  });

  test("Slack payload contains count, limit, and percentage", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 37_499 });
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 1);
    const text: string = fetchCalls[0].body.text;
    assert.ok(text.includes("37500"), `expected count in message, got: ${text}`);
    assert.ok(text.includes("50000"), `expected limit in message, got: ${text}`);
    assert.ok(text.includes("75.0%"), `expected percentage in message, got: ${text}`);
  });

  test("getStatus returns current count, limit, and date", () => {
    reset({ count: 123 });
    const status = quotaTracker.getStatus();
    assert.equal(status.count, 123);
    assert.equal(status.limit, 50_000);
    assert.match(status.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});
