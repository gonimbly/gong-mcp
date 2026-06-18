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
    delete process.env.GONG_DAILY_QUOTA;
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

  // ---- default limit is Gong's documented 10k/day ----

  test("isOverLimit returns false below the 10k default", () => {
    reset({ count: 9_999 });
    assert.equal(quotaTracker.isOverLimit(), false);
  });

  test("isOverLimit returns true at the 10k default", () => {
    reset({ count: 10_000 });
    assert.equal(quotaTracker.isOverLimit(), true);
  });

  test("isOverLimit returns true above the 10k default", () => {
    reset({ count: 10_001 });
    assert.equal(quotaTracker.isOverLimit(), true);
  });

  test("getStatus reports the 10k default limit", () => {
    reset({ count: 123 });
    const status = quotaTracker.getStatus();
    assert.equal(status.count, 123);
    assert.equal(status.limit, 10_000);
    assert.match(status.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  // ---- GONG_DAILY_QUOTA makes the limit configurable ----

  test("GONG_DAILY_QUOTA overrides the daily limit", () => {
    process.env.GONG_DAILY_QUOTA = "20000";
    reset({ count: 19_999 });
    assert.equal(quotaTracker.isOverLimit(), false);
    reset({ count: 20_000 });
    assert.equal(quotaTracker.isOverLimit(), true);
    assert.equal(quotaTracker.getStatus().limit, 20_000);
  });

  test("invalid GONG_DAILY_QUOTA falls back to the 10k default", () => {
    for (const bad of ["abc", "0", "-5", ""]) {
      process.env.GONG_DAILY_QUOTA = bad;
      assert.equal(quotaTracker.getStatus().limit, 10_000, `bad value: ${JSON.stringify(bad)}`);
    }
  });

  // ---- rollover ----

  test("rolls over counter when date changes", () => {
    reset({ count: 1_000, date: "2020-01-01" });
    quotaTracker.increment(); // triggers rollover since stored date is old
    assert.equal(quotaTracker.getStatus().count, 1);
    assert.notEqual(quotaTracker.getStatus().date, "2020-01-01");
  });

  test("isOverLimit resets to false after date rollover", () => {
    reset({ count: 10_000, date: "2020-01-01" });
    assert.equal(quotaTracker.isOverLimit(), false); // rolled over → count is now 0
    assert.equal(quotaTracker.getStatus().count, 0);
  });

  // ---- warning: 75% of limit, but never later than the 10k floor ----

  test("alert fires once when crossing 75% of the default limit (7,500)", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 7_499 });
    quotaTracker.increment(); // crosses 7,500
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://hooks.slack.com/test");
  });

  test("alert does not re-fire after already triggered", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 7_500, alerted: true });
    quotaTracker.increment();
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 0);
  });

  test("alert fires again after a day rollover", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 7_500, alerted: true, date: "2020-01-01" });
    quotaTracker.isOverLimit(); // triggers rollover — resets count, alerted, date
    assert.equal(t.alerted, false);
    assert.equal(t.count, 0);
    t.count = 7_499;
    quotaTracker.increment(); // should trigger alert again
    assert.equal(fetchCalls.length, 1);
  });

  test("no Slack fetch when webhook env var is unset", () => {
    delete process.env.ALERT_SLACK_WEBHOOK_URL;
    reset({ count: 7_499 });
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 0);
  });

  test("Slack payload contains count, limit, and percentage", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    reset({ count: 7_499 });
    quotaTracker.increment();
    assert.equal(fetchCalls.length, 1);
    const text: string = fetchCalls[0].body.text;
    assert.ok(text.includes("7500"), `expected count in message, got: ${text}`);
    assert.ok(text.includes("10000"), `expected limit in message, got: ${text}`);
    assert.ok(text.includes("75.0%"), `expected percentage in message, got: ${text}`);
  });

  // ---- the 10k alarm floor: guaranteed even if the limit is raised much higher ----

  test("alarm fires by the 10k mark even when the limit is raised far above it", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    process.env.GONG_DAILY_QUOTA = "100000"; // 75% would be 75,000
    reset({ count: 9_999 });
    quotaTracker.increment(); // crosses 10,000 — must alarm here, not wait for 75,000
    assert.equal(fetchCalls.length, 1, "expected the 10k floor to trigger the alarm");
  });

  test("the 10k floor does not fire one request early", () => {
    process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    process.env.GONG_DAILY_QUOTA = "100000";
    reset({ count: 9_998 });
    quotaTracker.increment(); // count 9,999 — below the floor
    assert.equal(fetchCalls.length, 0);
  });
});
