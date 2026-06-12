import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Guards the tool→API key mapping that broke production on 2026-06-12: stats
// endpoints take date-only filter.fromDate/toDate, never fromDateTime.
const { statsDateRange, statsFilter } = await import("./stats.js");

const DAY_MS = 86400_000;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

describe("statsDateRange", () => {
  test("defaults to the last 30 days ending yesterday (date-only)", () => {
    const { fromDate, toDate } = statsDateRange({});
    assert.match(fromDate, dateOnly);
    assert.match(toDate, dateOnly);
    assert.equal(toDate, new Date(Date.now() - DAY_MS).toISOString().slice(0, 10), "ends yesterday, never today");
    assert.equal(fromDate, new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10));
  });

  test("truncates ISO datetimes to their date part", () => {
    const { fromDate, toDate } = statsDateRange({
      fromDate: "2026-05-12T00:00:00Z",
      toDate: "2026-06-11T23:59:59Z",
    });
    assert.equal(fromDate, "2026-05-12");
    assert.equal(toDate, "2026-06-11");
  });

  test("passes date-only values through unchanged", () => {
    assert.deepEqual(statsDateRange({ fromDate: "2026-05-01", toDate: "2026-05-31" }), {
      fromDate: "2026-05-01",
      toDate: "2026-05-31",
    });
  });

  test("rejects values that are not dates at all", () => {
    assert.throws(() => statsDateRange({ fromDate: "last month" }), /date-only YYYY-MM-DD/);
  });
});

describe("statsFilter", () => {
  test("never emits fromDateTime/toDateTime keys", () => {
    const filter = statsFilter({ fromDate: "2026-05-12T00:00:00Z", toDate: "2026-06-11T23:59:59Z" });
    assert.deepEqual(Object.keys(filter).sort(), ["fromDate", "toDate"]);
  });

  test("includes userIds and workspaceId only when given", () => {
    const filter = statsFilter({ userIds: ["1", "2"], workspaceId: "ws-1" });
    assert.deepEqual(filter.userIds, ["1", "2"]);
    assert.equal(filter.workspaceId, "ws-1");
    const bare = statsFilter({ userIds: [] });
    assert.ok(!("userIds" in bare));
    assert.ok(!("workspaceId" in bare));
  });
});
