import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { PolicyGongClient } = await import("./policyClient.js");
const { findCalls, findMyCalls, summarizeCall } = await import("./discovery.js");
const { clearUserDirectoryCache } = await import("./directory.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;
type WorkspacePolicy = import("./permissionResolver.js").WorkspacePolicy;

const WS1 = "ws-1";
const SELF = { userId: "504", email: "member@gonimbly.com", fullName: "Member User" };

const USERS = [
  { id: "501", emailAddress: "Nikki.Mitchell@gonimbly.com", firstName: "Nikki", lastName: "Mitchell", title: "Account Executive", active: true },
  { id: "502", emailAddress: "brian.one@gonimbly.com", firstName: "Brian", lastName: "One", active: true },
  { id: "503", emailAddress: "brian.two@gonimbly.com", firstName: "Brian", lastName: "Two", active: false },
  { id: "504", emailAddress: "member@gonimbly.com", firstName: "Member", lastName: "User", active: true },
];

const ACME_CONTEXT = [{
  system: "Salesforce",
  objects: [{
    objectType: "Account",
    objectId: "001X",
    fields: [
      { name: "Name", value: "Acme Corp" },
      { name: "Website", value: "https://acme.com" },
      { name: "Domain__c", value: "acme.com" },
    ],
  }],
}];

const CALL_CONTENT = {
  topics: [{ name: "Pricing", duration: 120 }, { name: "Small Talk", duration: 0 }],
  trackers: [{ name: "Competitor", count: 2 }, { name: "Budget", count: 0 }],
  brief: "A brief.",
  keyPoints: [{ text: "Key point one" }, { text: "Key point two" }],
  callOutcome: { id: "o1", category: "Answered", name: "Qualified" },
  nextSteps: [{ text: "Send proposal" }],
};

// Six calls, newest first. The fake pages at 2/page → 3 pages.
const CALLS = [
  {
    metaData: { id: "c-1", workspaceId: WS1, title: "Acme <> GoNimbly sync", started: "2026-06-10T10:00:00Z", duration: 1800, direction: "Conference", url: "https://app.gong.io/call?id=c-1", primaryUserId: "501", scope: "External", media: "Video", language: "eng" },
    parties: [
      { userId: "501", name: "Nikki Mitchell", emailAddress: "nikki.mitchell@gonimbly.com", affiliation: "Internal", title: "Account Executive" },
      { name: "Bob Jones", emailAddress: "bob@acme.com", affiliation: "External" },
    ],
    context: ACME_CONTEXT,
    content: CALL_CONTENT,
  },
  {
    metaData: { id: "c-2", workspaceId: WS1, title: "Internal planning", started: "2026-06-09T10:00:00Z", duration: 900 },
    parties: [{ userId: "502", name: "Brian One", emailAddress: "brian.one@gonimbly.com", affiliation: "Internal" }],
  },
  {
    metaData: { id: "c-3", workspaceId: WS1, title: "Dynamic Planner kickoff", started: "2026-06-08T10:00:00Z", duration: 2400 },
    parties: [
      { userId: "503", name: "Brian Two", emailAddress: "brian.two@gonimbly.com", affiliation: "Internal" },
      { name: "Jane Doe", emailAddress: "jane@dynamicplanner.com", affiliation: "External" },
    ],
  },
  {
    metaData: { id: "c-4", workspaceId: WS1, title: "Prospect intro", started: "2026-06-07T10:00:00Z", duration: 600 },
    parties: [{ name: "Nikki External", emailAddress: "nikki@client-x.com", affiliation: "External" }],
  },
  {
    metaData: { id: "c-5", workspaceId: WS1, title: "1:1 sync", started: "2026-06-06T10:00:00Z", duration: 1500 },
    // Unlinked attendee record: email only, no userId
    parties: [{ name: "Member User", emailAddress: "member@gonimbly.com", affiliation: "Internal" }],
  },
  {
    metaData: { id: "c-6", workspaceId: WS1, title: "Team standup", started: "2026-06-05T10:00:00Z", duration: 700 },
    parties: [
      { userId: "999", name: "Someone Else", affiliation: "Internal" },
      { userId: "504", name: "Member User", emailAddress: "member@gonimbly.com", affiliation: "Internal" },
    ],
  },
];

const PAGE_SIZE = 2;

interface CapturedRequest {
  url: string;
  method: string;
  body?: any;
}

let requests: CapturedRequest[] = [];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

// Strict fake — encodes the live API's verified behavior (2026-06-12 probe):
// missing `filter` key → 400; zero matches → 404 "No calls found"; parties /
// context / content come back only when the contentSelector asks for them.
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body });

  if (url.includes("/v2/calls/extensive")) {
    if (!body || !("filter" in body)) {
      return json({ errors: ["Json parse error, verify Json format matches the API description."] }, 400);
    }
    const callIds: string[] | undefined = body.filter.callIds;
    const wsId: string | undefined = body.filter.workspaceId;
    let filtered = CALLS;
    if (callIds) filtered = filtered.filter((c) => callIds.includes(c.metaData.id));
    if (wsId) filtered = filtered.filter((c) => c.metaData.workspaceId === wsId);
    if (filtered.length === 0) {
      return json({ requestId: "r1", errors: ["No calls found corresponding to the provided filters"] }, 404);
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
        currentPageSize: page.length,
        ...(offset + PAGE_SIZE < filtered.length ? { cursor: String(offset + PAGE_SIZE) } : {}),
      },
    });
  }

  if (url.includes("/v2/users")) {
    const cursorMatch = url.match(/cursor=(\d+)/);
    const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
    const page = USERS.slice(offset, offset + PAGE_SIZE);
    return json({
      users: page,
      records: {
        totalRecords: USERS.length,
        ...(offset + PAGE_SIZE < USERS.length ? { cursor: String(offset + PAGE_SIZE) } : {}),
      },
    });
  }

  return json({ ok: true });
}) as typeof fetch;

const client = new GongClient();

function ws(workspaceId: string, over: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    workspaceId,
    profileId: "p1",
    profileName: "Test Profile",
    calls: { level: "all", visibleUserIds: null },
    deals: { level: "all", visibleUserIds: null },
    coaching: { level: "all", visibleUserIds: null },
    stats: { level: "all", visibleUserIds: null },
    library: { level: "all", folderIds: null },
    ...over,
  };
}

function policy(workspaces: WorkspacePolicy[]): UserPolicy {
  return {
    userId: SELF.userId,
    email: SELF.email,
    workspaceIds: workspaces.map((w) => w.workspaceId),
    perWorkspace: new Map(workspaces.map((w) => [w.workspaceId, w])),
    capabilities: {
      downloadCallMedia: false,
      privateCalls: false,
      manageScorecards: false,
      crmWrite: false,
      techAdmin: false,
      scheduleCalls: false,
    },
    degraded: false,
  };
}

const extensiveRequests = () => requests.filter((r) => r.url.includes("/v2/calls/extensive"));

beforeEach(() => {
  requests = [];
  clearUserDirectoryCache();
});

describe("findCalls guardrails", () => {
  test("rejects when no narrowing param is given, before any API call", async () => {
    await assert.rejects(findCalls(client, {}), /at least one of participant, account, or titleContains/);
    assert.equal(requests.length, 0);
  });

  test("defaults the date range to the last 30 days", async () => {
    await findCalls(client, { participant: "nikki" });
    const body = extensiveRequests()[0].body;
    const from = new Date(body.filter.fromDateTime).getTime();
    const to = new Date(body.filter.toDateTime).getTime();
    assert.ok(Math.abs(to - Date.now()) < 60_000, "toDateTime ≈ now");
    assert.ok(Math.abs(to - from - 30 * 86400_000) < 60_000, "range ≈ 30 days");
    assert.equal(body.contentSelector.exposedFields.parties, true, "parties requested explicitly");
  });
});

describe("findCalls participant matching", () => {
  test("resolves a unique name and matches by userId and by email/name fragment", async () => {
    const result = await findCalls(client, { participant: "nikki" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1", "c-4"]);
    assert.deepEqual(result.calls[0].matchedOn, ["participant:userId"]);
    assert.deepEqual(result.calls[1].matchedOn, ["participant:email"], "external attendee matched by email fragment");
    assert.equal(result.participantResolution?.ambiguous, false);
    assert.deepEqual(result.participantResolution?.matchedUsers.map((u) => u.userId), ["501"]);
    assert.equal(result.coverage.scannedCalls, 6);
    assert.equal(result.coverage.matchedCalls, 2);
    assert.equal(result.coverage.truncated, false);
    assert.equal(result.coverage.totalCallsInRange, 6);
  });

  test("ambiguous names match calls for ALL resolved users and say so", async () => {
    const result = await findCalls(client, { participant: "brian" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-2", "c-3"]);
    assert.equal(result.participantResolution?.ambiguous, true);
    assert.deepEqual(result.participantResolution?.matchedUsers.map((u) => u.userId), ["502", "503"]);
    assert.match(result.participantResolution?.note ?? "", /matched 2 Gong users/);
  });

  test("a participant with no directory match still matches external attendees by email", async () => {
    const result = await findCalls(client, { participant: "nikki@client-x.com" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-4"]);
    assert.equal(result.participantResolution?.matchedUsers.length, 0);
    assert.match(result.participantResolution?.note ?? "", /matched no Gong user/);
  });
});

describe("findCalls account matching", () => {
  test("matches via CRM context and requests it only when account is given", async () => {
    const result = await findCalls(client, { account: "Acme Corp" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1"]);
    assert.deepEqual(result.calls[0].matchedOn, ["account:crm-context"]);
    assert.equal(result.calls[0].account, "Acme Corp");
    assert.equal(extensiveRequests()[0].body.contentSelector.context, "Extended");

    requests = [];
    await findCalls(client, { participant: "nikki" });
    assert.equal(extensiveRequests()[0].body.contentSelector.context, undefined, "no CRM context without an account query");
  });

  test("falls back to external email domains, compacting punctuation", async () => {
    // "dynamicplanner" is not in any CRM field or title ("Dynamic Planner kickoff" has a space)
    const result = await findCalls(client, { account: "dynamicplanner" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-3"]);
    assert.deepEqual(result.calls[0].matchedOn, ["account:external-domain"]);

    // "Client X" → client-x.com only via compaction
    const compacted = await findCalls(client, { account: "Client X" });
    assert.deepEqual(compacted.calls.map((c) => c.id), ["c-4"]);
    assert.deepEqual(compacted.calls[0].matchedOn, ["account:external-domain"]);
  });

  test("internal participants' domains never count as an account match", async () => {
    const result = await findCalls(client, { account: "gonimbly" });
    // c-1 matches via its title; c-2/c-5/c-6 have gonimbly.com parties but all Internal
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1"]);
    assert.deepEqual(result.calls[0].matchedOn, ["account:title"]);
  });

  test("combined filters AND together", async () => {
    const result = await findCalls(client, { participant: "nikki", account: "acme.com", titleContains: "sync" });
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1"]);
    assert.deepEqual(result.calls[0].matchedOn, ["participant:userId", "account:crm-context", "title"]);
  });
});

describe("findCalls pagination and coverage", () => {
  test("follows cursors across all pages by default", async () => {
    await findCalls(client, { participant: "nikki" });
    const cursors = extensiveRequests().map((r) => r.body.cursor);
    assert.deepEqual(cursors, [undefined, "2", "4"]);
  });

  test("reports truncation honestly when stopping at maxPages", async () => {
    const result = await findCalls(client, { participant: "nikki", maxPages: 2 });
    assert.equal(result.coverage.pagesScanned, 2);
    assert.equal(result.coverage.truncated, true);
    assert.equal(result.coverage.scannedCalls, 4);
    assert.equal(result.coverage.totalCallsInRange, 6);
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1", "c-4"], "pages 1–2 only (c-5/c-6 were never seen)");
  });

  test("treats Gong's 404 'No calls found' as an empty result, not an error", async () => {
    const result = await findCalls(client, { participant: "nikki", workspaceId: "ws-empty" });
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.coverage, { scannedCalls: 0, matchedCalls: 0, pagesScanned: 0, truncated: false, totalCallsInRange: 0 });
  });
});

describe("findCalls through the policy layer", () => {
  test("a scoped member only matches within their visible set, with the policy note propagated", async () => {
    const manager = policy([ws(WS1, { calls: { level: "managers-team", visibleUserIds: new Set(["504", "501"]) } })]);
    const scoped = new PolicyGongClient(SELF, manager);

    const result = await findCalls(scoped, { participant: "nikki" });
    // Post-policy pages: c-1 (501 visible), c-5 (own email on an unlinked record), c-6 (504)
    assert.equal(result.coverage.scannedCalls, 3);
    assert.deepEqual(result.calls.map((c) => c.id), ["c-1"]);
    assert.equal(result.coverage.totalCallsInRange, 6, "raw pre-policy count is still reported");
    assert.match(result.policyNote ?? "", /limited to calls visible/i);
  });
});

describe("findMyCalls", () => {
  test("matches the session user by userId and by bare-email party records", async () => {
    const result = await findMyCalls(client, SELF, {});
    assert.deepEqual(result.calls.map((c) => c.id), ["c-5", "c-6"]);
    assert.deepEqual(result.calls[0].matchedOn, ["participant:email"], "unlinked attendee record matched by exact email");
    assert.deepEqual(result.calls[1].matchedOn, ["participant:userId"]);
  });

  test("does not fragment-match other people", async () => {
    // "member" appears in c-5/c-6 party names, but exact-email semantics must not
    // match e.g. a hypothetical other-member@… — covered by matching only
    // 504/member@gonimbly.com here: c-2 (brian) stays out.
    const result = await findMyCalls(client, SELF, {});
    assert.ok(!result.calls.some((c) => c.id === "c-2"));
  });
});

describe("summarizeCall", () => {
  test("returns a compact digest: flattened outcome/keyPoints, zero-count noise dropped", async () => {
    const digest = await summarizeCall(client, "c-1");
    assert.equal(digest.id, "c-1");
    assert.equal(digest.url, "https://app.gong.io/call?id=c-1");
    assert.equal(digest.account, "Acme Corp");
    assert.equal(digest.outcome, "Qualified");
    assert.equal(digest.brief, "A brief.");
    assert.deepEqual(digest.keyPoints, ["Key point one", "Key point two"]);
    assert.deepEqual(digest.nextSteps, ["Send proposal"]);
    assert.deepEqual(digest.topics, [{ name: "Pricing", durationSec: 120 }], "zero-duration topics dropped");
    assert.deepEqual(digest.trackers, [{ name: "Competitor", count: 2 }], "zero-count trackers dropped");
    assert.equal(digest.participants[0].title, "Account Executive");

    const body = extensiveRequests()[0].body;
    assert.deepEqual(body.filter, { callIds: ["c-1"] });
    assert.equal(body.contentSelector.exposedFields.content.brief, true);
  });

  test("a call hidden by policy reads as not-found, same as a missing call", async () => {
    const restricted = policy([ws(WS1, { calls: { level: "none", visibleUserIds: new Set(["504"]) } })]);
    const scoped = new PolicyGongClient(SELF, restricted);
    await assert.rejects(summarizeCall(scoped, "c-1"), /not found or is not visible/);
    await assert.rejects(summarizeCall(client, "no-such-call"), /not found or is not visible/);
  });
});
