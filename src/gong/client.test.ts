import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GongClient } from "./client.js";
import { quotaTracker } from "./quota.js";

// Use org credential path to bypass local OAuth keychain
process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";

let fetchCalls: { url: string; init: RequestInit }[] = [];
let alertMessages: string[] = [];

function mockFetch(responses: { status: number; body?: string }[]) {
  let i = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return new Response(r.body ?? "", { status: r.status });
  }) as typeof fetch;
}

beforeEach(async () => {
  fetchCalls = [];
  alertMessages = [];
  process.env.ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
  // Intercept the alert webhook separately from API calls
  // by tracking fetch calls whose URL matches the webhook
});

// Helper to make one listWorkspaces() call and collect webhook posts
async function callAndCapture(client: GongClient): Promise<string[]> {
  const alerts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://hooks.slack.com")) {
      const body = JSON.parse((init?.body as string) ?? "{}");
      alerts.push(body.text ?? "");
      return new Response(null, { status: 200 });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  try {
    await client.listWorkspaces().catch(() => {});
  } finally {
    globalThis.fetch = realFetch;
  }
  return alerts;
}

describe("GongClient — 429 alert", () => {
  test("fires Slack alert on 429 response", async () => {
    const client = new GongClient("https://api.gong.io");
    const alerts: string[] = [];

    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://hooks.slack.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        alerts.push(body.text);
        return new Response(null, { status: 200 });
      }
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;

    await client.listWorkspaces().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].includes("429"), `expected 429 in message, got: ${alerts[0]}`);
  });

  test("does not fire 429 alert on other non-2xx status", async () => {
    const client = new GongClient("https://api.gong.io");
    const alerts: string[] = [];

    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://hooks.slack.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        alerts.push(body.text);
        return new Response(null, { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }) as typeof fetch;

    await client.listWorkspaces().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));

    // Only the consecutive-error alert may fire (after 5 errors), not a 429-specific one
    const has429Alert = alerts.some((a) => a.includes("429"));
    assert.equal(has429Alert, false);
  });
});

describe("GongClient — consecutive error spike", () => {
  test("fires alert after 5 consecutive errors and not before", async () => {
    const client = new GongClient("https://api.gong.test");
    const alerts: string[] = [];

    // Reset module-level counter by making one successful call before the error sequence.
    // consecutiveErrors is shared across tests; a prior test may have incremented it.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })
    ) as typeof fetch;
    await client.listWorkspaces().catch(() => {});

    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://hooks.slack.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        alerts.push(body.text);
        return new Response(null, { status: 200 });
      }
      return new Response("error", { status: 500 });
    }) as typeof fetch;

    // 4 errors — should NOT trigger consecutive alert yet
    for (let i = 0; i < 4; i++) {
      await client.listWorkspaces().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 0));
    const consecutiveAlertsBefore = alerts.filter((a) => a.includes("consecutive")).length;
    assert.equal(consecutiveAlertsBefore, 0, "alert should not fire before threshold");

    // 5th error — should trigger
    await client.listWorkspaces().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const consecutiveAlertsAfter = alerts.filter((a) => a.includes("consecutive")).length;
    assert.equal(consecutiveAlertsAfter, 1, "alert should fire exactly once at threshold");
  });

  test("alert fires only once per spike regardless of further errors", async () => {
    // This test runs AFTER the previous one — the counter will already be ≥5
    // so the alert was already fired. Further errors should not re-fire it.
    const client = new GongClient("https://api.gong.test");
    const newAlerts: string[] = [];

    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://hooks.slack.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        newAlerts.push(body.text);
        return new Response(null, { status: 200 });
      }
      return new Response("error", { status: 500 });
    }) as typeof fetch;

    await client.listWorkspaces().catch(() => {});
    await client.listWorkspaces().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const consecutiveAlerts = newAlerts.filter((a) => a.includes("consecutive")).length;
    assert.equal(consecutiveAlerts, 0, "alert should not re-fire within same spike");
  });

  test("counter resets on success — new spike triggers a fresh alert", async () => {
    const client = new GongClient("https://api.gong.test");
    const alerts: string[] = [];
    let callCount = 0;

    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://hooks.slack.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        alerts.push(body.text);
        return new Response(null, { status: 200 });
      }
      callCount++;
      // First call succeeds (resets counter), subsequent calls fail
      if (callCount === 1) return new Response(JSON.stringify({}), { status: 200 });
      return new Response("error", { status: 500 });
    }) as typeof fetch;

    // Reset the counter with one success
    await client.listWorkspaces().catch(() => {});
    // Now trigger a new spike
    for (let i = 0; i < 5; i++) {
      await client.listWorkspaces().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 0));
    const consecutiveAlerts = alerts.filter((a) => a.includes("consecutive")).length;
    assert.equal(consecutiveAlerts, 1, "fresh spike should trigger a new alert");
  });
});

describe("GongClient — daily quota gate", () => {
  test("over-limit request reports the live limit, not a hard-coded number", async () => {
    const q = quotaTracker as any;
    const savedCount = q.count;
    const savedDate = q.date;
    try {
      process.env.GONG_DAILY_QUOTA = "12345";
      q.date = new Date().toISOString().slice(0, 10);
      q.count = 12_345; // at the configured limit
      const client = new GongClient("https://api.gong.test");
      await assert.rejects(
        () => client.listWorkspaces(),
        (err: Error) =>
          err.message.includes("12345") && !err.message.includes("50,000")
      );
    } finally {
      q.count = savedCount;
      q.date = savedDate;
      delete process.env.GONG_DAILY_QUOTA;
    }
  });
});
