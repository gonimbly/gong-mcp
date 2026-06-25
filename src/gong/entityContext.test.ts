import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { aggregateEntityContext } = await import("./entityContext.js");
const { clearUserDirectoryCache } = await import("./directory.js");

const WS1 = "ws-1";

// Salesforce context: Account 001X "Acme Corp" + Opportunity 006Y on c-1; c-2
// links only the Account; c-3 links nothing.
const ACME_FULL = [{
  system: "Salesforce",
  objects: [
    { objectType: "Account", objectId: "001X", fields: [{ name: "Name", value: "Acme Corp" }] },
    { objectType: "Opportunity", objectId: "006Y", fields: [{ name: "Name", value: "Acme - New Business" }] },
  ],
}];
const ACME_ACCOUNT_ONLY = [{
  system: "Salesforce",
  objects: [{ objectType: "Account", objectId: "001X", fields: [{ name: "Name", value: "Acme Corp" }] }],
}];

const CONTENT = {
  topics: [{ name: "Pricing", duration: 120 }, { name: "Filler", duration: 0 }],
  trackers: [{ name: "Competitor", count: 2 }, { name: "Budget", count: 0 }],
  brief: "Discussed pricing and next steps.",
  keyPoints: [{ text: "Wants annual billing" }],
  callOutcome: { name: "Qualified" },
  nextSteps: [{ text: "Send proposal" }],
};

const CALLS = [
  {
    metaData: { id: "c-1", workspaceId: WS1, title: "Acme sync", started: "2026-06-10T10:00:00Z", duration: 1800 },
    parties: [
      { userId: "501", name: "Nikki Mitchell", emailAddress: "nikki@gonimbly.com", affiliation: "Internal", title: "AE" },
      { name: "Bob Jones", emailAddress: "bob@acme.com", affiliation: "External" },
    ],
    context: ACME_FULL,
    content: CONTENT,
  },
  {
    metaData: { id: "c-2", workspaceId: WS1, title: "Acme follow-up", started: "2026-06-09T10:00:00Z", duration: 1200 },
    parties: [{ name: "Carol Lee", emailAddress: "carol@acme.com", affiliation: "External" }],
    context: ACME_ACCOUNT_ONLY,
    content: CONTENT,
  },
  {
    metaData: { id: "c-3", workspaceId: WS1, title: "Unrelated internal", started: "2026-06-08T10:00:00Z", duration: 600 },
    parties: [{ userId: "502", name: "Dave", emailAddress: "dave@gonimbly.com", affiliation: "Internal" }],
    content: CONTENT,
  },
];

const PAGE_SIZE = 10; // > any callIds set we request, so the batched enrich is single-page
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;

  if (url.includes("/v2/calls/extensive")) {
    if (!body || !("filter" in body)) return json({ errors: ["Json parse error"] }, 400);
    const callIds: string[] | undefined = body.filter.callIds;
    let filtered = CALLS;
    if (callIds) filtered = filtered.filter((c) => callIds.includes(c.metaData.id));
    if (filtered.length === 0) {
      return json({ errors: ["No calls found corresponding to the provided filters"] }, 404);
    }
    const offset = body.cursor ? Number(body.cursor) : 0;
    const exposed = body.contentSelector?.exposedFields ?? {};
    const withContext = body.contentSelector?.context === "Extended";
    const page = filtered.slice(offset, offset + PAGE_SIZE).map((c) => ({
      metaData: c.metaData,
      ...(exposed.parties === true ? { parties: c.parties } : {}),
      ...(withContext && c.context ? { context: c.context } : {}),
      ...(exposed.content && c.content ? { content: c.content } : {}),
    }));
    return json({
      calls: page,
      records: {
        totalRecords: filtered.length,
        ...(offset + PAGE_SIZE < filtered.length ? { cursor: String(offset + PAGE_SIZE) } : {}),
      },
    });
  }

  if (url.includes("/v2/calls/transcript")) {
    const callIds: string[] = body?.filter?.callIds ?? [];
    return json({
      callTranscripts: callIds.map((callId) => ({
        callId,
        transcript: [{ speakerId: "501", topic: "Pricing", sentences: [{ text: "Let's talk numbers.", start: 0 }] }],
      })),
    });
  }

  if (url.includes("/v2/users")) return json({ users: [], records: { totalRecords: 0 } });
  return json({ ok: true });
}) as typeof fetch;

const client = new GongClient();
const RANGE = { fromDateTime: "2026-06-01T00:00:00Z", toDateTime: "2026-06-30T00:00:00Z" };

beforeEach(() => clearUserDirectoryCache());

describe("aggregateEntityContext — credit-free entity context", () => {
  test("ACCOUNT: links calls by Salesforce Account id, newest first, with digest fields", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "ACCOUNT", entityRef: "001X", ...RANGE });
    assert.deepEqual(res.entity, { crmEntityType: "ACCOUNT", entityRef: "001X" });
    assert.deepEqual(res.calls.map((c) => c.id), ["c-1", "c-2"], "both Acme-linked calls, newest first");
    const c1 = res.calls[0];
    assert.equal(c1.brief, "Discussed pricing and next steps.");
    assert.deepEqual(c1.keyPoints, ["Wants annual billing"]);
    assert.deepEqual(c1.nextSteps, ["Send proposal"]);
    assert.equal(c1.outcome, "Qualified");
    assert.deepEqual(c1.topics, [{ name: "Pricing", durationSec: 120 }], "zero-duration topics dropped");
    assert.equal(res.coverage.matchedCalls, 2);
    assert.ok(res.calls.every((c) => c.transcript === undefined), "no transcripts unless asked");
  });

  test("DEAL: links calls by Salesforce Opportunity id only", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "DEAL", entityRef: "006Y", ...RANGE });
    assert.deepEqual(res.calls.map((c) => c.id), ["c-1"], "only the call linked to the opportunity");
  });

  test("CONTACT: links calls by participant email", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "CONTACT", entityRef: "bob@acme.com", ...RANGE });
    assert.deepEqual(res.calls.map((c) => c.id), ["c-1"], "the call Bob attended");
  });

  test("maxCalls caps the enriched set to the newest N", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "ACCOUNT", entityRef: "001X", maxCalls: 1, ...RANGE });
    assert.deepEqual(res.calls.map((c) => c.id), ["c-1"]);
  });

  test("includeTranscripts attaches a speaker-attributed transcript per call", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "DEAL", entityRef: "006Y", includeTranscripts: true, ...RANGE });
    assert.equal(res.calls.length, 1);
    assert.ok(res.calls[0].transcript, "transcript attached");
    assert.equal(res.calls[0].transcript?.callId, "c-1");
  });

  test("unknown entity ref yields an empty, well-formed result", async () => {
    const res = await aggregateEntityContext(client, { crmEntityType: "ACCOUNT", entityRef: "001-NOPE", ...RANGE });
    assert.deepEqual(res.calls, []);
    assert.equal(res.coverage.matchedCalls, 0);
  });
});
