import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { findCalls } = await import("./discovery.js");

// Faithful to the LIVE API in the way that matters for newest-first windowing:
// calls come back ASCENDING (oldest-first) and the endpoint honours the
// from/to filter. The shared discovery.test.ts mock returns newest-first and
// ignores dates, so it cannot exercise the windowing branch — this one can.
const PAGE_SIZE = 100; // must match discovery's page-size assumption
const RANGE_FROM = "2026-05-01T00:00:00.000Z";
const RANGE_TO = "2026-05-31T00:00:00.000Z";

// 250 calls, one every ~2.9h across the 30-day range, oldest → newest. Two carry
// a unique account token: one on the newest day, one on the oldest.
const NEW_ID = "match-new";
const OLD_ID = "match-old";
const ALL_CALLS = (() => {
  const fromMs = Date.parse(RANGE_FROM);
  const toMs = Date.parse(RANGE_TO);
  const n = 250;
  const step = (toMs - fromMs) / n;
  const calls = [];
  for (let i = 0; i < n; i++) {
    const started = new Date(fromMs + i * step).toISOString();
    const id = i === n - 1 ? NEW_ID : i === 1 ? OLD_ID : `c-${i}`;
    const title = id === NEW_ID ? "ZEBRACO kickoff" : id === OLD_ID ? "ZEBRACO old planning" : `Routine sync ${i}`;
    calls.push({ metaData: { id, workspaceId: "ws-1", title, started, duration: 600 }, parties: [] });
  }
  return calls; // ascending by started
})();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;

  if (url.includes("/v2/calls/extensive")) {
    const from = Date.parse(body.filter.fromDateTime);
    const to = Date.parse(body.filter.toDateTime);
    const filtered = ALL_CALLS.filter((c) => {
      const t = Date.parse(c.metaData.started);
      return t >= from && t <= to; // ascending order preserved
    });
    if (filtered.length === 0) {
      return json({ requestId: "r", errors: ["No calls found corresponding to the provided filters"] }, 404);
    }
    const offset = body.cursor ? Number(body.cursor) : 0;
    const page = filtered.slice(offset, offset + PAGE_SIZE);
    return json({
      calls: page.map((c) => ({ metaData: c.metaData, parties: c.parties })),
      records: {
        totalRecords: filtered.length,
        currentPageSize: page.length,
        ...(offset + PAGE_SIZE < filtered.length ? { cursor: String(offset + PAGE_SIZE) } : {}),
      },
    });
  }
  return json({ ok: true });
}) as typeof fetch;

const client = new GongClient();

describe("findCalls newest-first windowing (oldest-first API)", () => {
  test("covers the most recent calls and reports an honest recency floor", async () => {
    // total (250) exceeds maxPages*100 (200) → windowing engages.
    const result = await findCalls(client, {
      account: "ZEBRACO",
      fromDateTime: RANGE_FROM,
      toDateTime: RANGE_TO,
      maxPages: 2,
    });

    const ids = result.calls.map((c) => c.id);
    assert.ok(ids.includes(NEW_ID), "the newest matching call is found");
    assert.ok(!ids.includes(OLD_ID), "the oldest matching call is NOT scanned (budget spent newest-first)");

    assert.equal(result.coverage.truncated, true, "older calls remain unscanned");
    assert.equal(result.coverage.totalCallsInRange, 250, "raw range count is reported");
    assert.ok(result.coverage.scannedFrom, "a recency floor is reported");
    assert.ok(
      Date.parse(result.coverage.scannedFrom!) > Date.parse(RANGE_FROM),
      "scannedFrom is well after the range start — only recent calls were examined",
    );
    assert.match(result.note ?? "", /recency-bounded|older/i, "truncation is surfaced in the note");
  });

  test("a range that fits the budget is scanned whole, no truncation", async () => {
    // A 3-day recent slice holds ~25 calls < budget → simple forward path.
    const result = await findCalls(client, {
      account: "ZEBRACO",
      fromDateTime: "2026-05-28T00:00:00.000Z",
      toDateTime: RANGE_TO,
      maxPages: 5,
    });
    assert.equal(result.coverage.truncated, false);
    assert.ok(result.calls.map((c) => c.id).includes(NEW_ID));
  });
});
