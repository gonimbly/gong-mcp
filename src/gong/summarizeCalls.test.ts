import { describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { summarizeCalls } = await import("./discovery.js");

// Three calls, a deliberately tiny 2-per-page fake → forces a second page so the
// cursor-follow path is exercised. Guards against silent truncation when a
// callIds set exceeds one API page.
const CALLS = [
  { metaData: { id: "c-1", started: "2026-06-03T00:00:00Z", title: "One" }, content: { brief: "b1" } },
  { metaData: { id: "c-2", started: "2026-06-02T00:00:00Z", title: "Two" }, content: { brief: "b2" } },
  { metaData: { id: "c-3", started: "2026-06-01T00:00:00Z", title: "Three" }, content: { brief: "b3" } },
];
const PAGE_SIZE = 2;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

let extensiveRequests = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  if (url.includes("/v2/calls/extensive")) {
    extensiveRequests++;
    const ids: string[] = body?.filter?.callIds ?? [];
    const matched = CALLS.filter((c) => ids.includes(c.metaData.id));
    const offset = body?.cursor ? Number(body.cursor) : 0;
    const exposed = body?.contentSelector?.exposedFields ?? {};
    const page = matched.slice(offset, offset + PAGE_SIZE).map((c) => ({
      metaData: c.metaData,
      ...(exposed.content && c.content ? { content: c.content } : {}),
    }));
    return json({
      calls: page,
      records: {
        totalRecords: matched.length,
        ...(offset + PAGE_SIZE < matched.length ? { cursor: String(offset + PAGE_SIZE) } : {}),
      },
    });
  }
  return json({ ok: true });
}) as typeof fetch;

const client = new GongClient();

describe("summarizeCalls — cursor-safe batched enrichment", () => {
  test("follows the cursor so a multi-page callIds set is never truncated", async () => {
    extensiveRequests = 0;
    const digests = await summarizeCalls(client, ["c-1", "c-2", "c-3"]);
    assert.deepEqual(digests.map((d) => d.id), ["c-1", "c-2", "c-3"], "all three enriched across two pages");
    assert.equal(extensiveRequests, 2, "exactly two extensive requests (2 + 1)");
    assert.equal(digests[2].brief, "b3");
  });

  test("empty input makes no request", async () => {
    extensiveRequests = 0;
    assert.deepEqual(await summarizeCalls(client, []), []);
    assert.equal(extensiveRequests, 0);
  });
});
