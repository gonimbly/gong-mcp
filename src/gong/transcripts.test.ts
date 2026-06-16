import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GONG_ACCESS_KEY = "test-key";
process.env.GONG_ACCESS_KEY_SECRET = "test-secret";
process.env.GONG_BASE_URL = "https://gong.test";

const { GongClient } = await import("./client.js");
const { PolicyGongClient } = await import("./policyClient.js");
const { AccessDeniedError } = await import("./scopedClient.js");
const { attributeTranscripts } = await import("./transcripts.js");
type UserPolicy = import("./permissionResolver.js").UserPolicy;
type WorkspacePolicy = import("./permissionResolver.js").WorkspacePolicy;

const SELF = { userId: "504", email: "member@gonimbly.com", fullName: "Member User" };

// Transcript monologues keyed by callId. speakerIds intentionally differ from
// userIds (the live API's three separate ID spaces — see the issue report).
const TRANSCRIPTS: Record<string, Array<Record<string, unknown>>> = {
  "call-1": [
    { speakerId: "spk-nikki", topic: "Intro", sentences: [{ start: 0, end: 5, text: "Hi all." }] },
    { speakerId: "spk-david", topic: "Pricing", sentences: [{ start: 6, end: 12, text: "What's the cost?" }] },
    { speakerId: "spk-ghost", topic: "Wrap", sentences: [{ start: 13, end: 15, text: "Bye." }] },
  ],
  // Same speakerId VALUE as call-1 but a different person — guards per-call isolation.
  "call-2": [{ speakerId: "spk-nikki", topic: "Other", sentences: [{ start: 0, end: 4, text: "Different call." }] }],
  // Numeric speakerId vs string party speakerId — guards the String() join.
  "call-num": [{ speakerId: 12, topic: "Nums", sentences: [{ start: 0, end: 2, text: "Numbers." }] }],
  // Transcript with no matching extensive record at all — triggers the 404 path.
  "call-orphan": [{ speakerId: "x", topic: "T", sentences: [{ start: 0, end: 1, text: "Orphaned." }] }],
};

// Parties (extensive, parties exposed) keyed by callId. speakerId present only
// for parties who spoke; Silent Bob has none.
const PARTIES: Record<string, Array<Record<string, unknown>>> = {
  "call-1": [
    { speakerId: "spk-nikki", userId: "501", name: "Nikki Mitchell", emailAddress: "Nikki@gonimbly.com", affiliation: "Internal", title: "AE" },
    { speakerId: "spk-david", name: "David Twamley", emailAddress: "david@delinea.com", affiliation: "External" },
    { name: "Silent Bob", emailAddress: "bob@gonimbly.com", affiliation: "Internal" },
  ],
  "call-2": [{ speakerId: "spk-nikki", userId: "999", name: "Different Person", emailAddress: "diff@delinea.com", affiliation: "Internal" }],
  "call-num": [{ speakerId: "12", name: "Numeric Nan", emailAddress: "nan@delinea.com", affiliation: "External" }],
  // call-orphan deliberately absent.
};

interface CapturedRequest { url: string; method: string; body?: any }
let requests: CapturedRequest[] = [];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body });

  if (url.includes("/v2/calls/transcript")) {
    const ids: string[] = body?.filter?.callIds ?? [];
    const callTranscripts = ids.filter((id) => TRANSCRIPTS[id]).map((id) => ({ callId: id, transcript: TRANSCRIPTS[id] }));
    return json({ callTranscripts });
  }

  if (url.includes("/v2/calls/extensive")) {
    if (!body || !("filter" in body)) {
      return json({ errors: ["Json parse error, verify Json format matches the API description."] }, 400);
    }
    const ids: string[] = body.filter.callIds ?? [];
    const exposed = body.contentSelector?.exposedFields ?? {};
    const calls = ids
      .filter((id) => PARTIES[id])
      .map((id) => ({ metaData: { id, workspaceId: "ws-1" }, ...(exposed.parties === true ? { parties: PARTIES[id] } : {}) }));
    if (calls.length === 0) {
      return json({ requestId: "r1", errors: ["No calls found corresponding to the provided filters"] }, 404);
    }
    return json({ calls, records: { totalRecords: calls.length, currentPageSize: calls.length } });
  }

  return json({ ok: true });
}) as typeof fetch;

const client = new GongClient();

function ws(over: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    workspaceId: "ws-1",
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

function policy(over: Partial<WorkspacePolicy> = {}): UserPolicy {
  const w = ws(over);
  return {
    userId: SELF.userId,
    email: SELF.email,
    workspaceIds: [w.workspaceId],
    perWorkspace: new Map([[w.workspaceId, w]]),
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

const transcriptRequests = () => requests.filter((r) => r.url.includes("/v2/calls/transcript"));
const extensiveRequests = () => requests.filter((r) => r.url.includes("/v2/calls/extensive"));

beforeEach(() => {
  requests = [];
});

describe("attributeTranscripts", () => {
  test("resolves each monologue to a name + affiliation, with a full speaker roster", async () => {
    const result = await attributeTranscripts(client, ["call-1"]);
    const call = result.callTranscripts[0];

    assert.equal(call.callId, "call-1");
    // Inline attribution, in transcript order.
    assert.deepEqual(call.transcript[0].speaker, { name: "Nikki Mitchell", affiliation: "Internal" });
    assert.deepEqual(call.transcript[1].speaker, { name: "David Twamley", affiliation: "External" });
    // Raw speakerId preserved on every line.
    assert.equal(call.transcript[0].speakerId, "spk-nikki");
    // Original transcript content untouched (additive).
    assert.deepEqual(call.transcript[0].sentences, [{ start: 0, end: 5, text: "Hi all." }]);

    // Full crosswalk roster — incl. the external participant, with email/userId/title.
    assert.deepEqual(call.speakers["spk-nikki"], {
      name: "Nikki Mitchell",
      email: "Nikki@gonimbly.com",
      userId: "501",
      affiliation: "Internal",
      title: "AE",
    });
    assert.equal(call.speakers["spk-david"].affiliation, "External");
    assert.equal(call.speakers["spk-david"].email, "david@delinea.com");
    // Silent Bob (no speakerId) is not in the roster — he can't appear in the transcript.
    assert.equal(Object.keys(call.speakers).length, 2);
    assert.equal(result.note, undefined);
  });

  test("fetches transcripts BEFORE parties, and requests parties explicitly", async () => {
    await attributeTranscripts(client, ["call-1"]);
    assert.equal(transcriptRequests().length, 1);
    assert.equal(extensiveRequests().length, 1);
    // Order: transcript first (fail-closed under policy).
    assert.ok(requests[0].url.includes("/v2/calls/transcript"));
    assert.ok(requests[1].url.includes("/v2/calls/extensive"));
    // Parties must be explicitly requested.
    assert.equal(extensiveRequests()[0].body.contentSelector.exposedFields.parties, true);
  });

  test("joins numeric transcript speakerId to string party speakerId", async () => {
    const result = await attributeTranscripts(client, ["call-num"]);
    const m = result.callTranscripts[0].transcript[0];
    assert.equal(m.speakerId, "12");
    assert.deepEqual(m.speaker, { name: "Numeric Nan", affiliation: "External" });
  });

  test("marks unknown speakers (no matching party) as unattributed without throwing", async () => {
    const result = await attributeTranscripts(client, ["call-1"]);
    const call = result.callTranscripts[0];
    // spk-ghost has a monologue but no party.
    assert.equal(call.transcript[2].speakerId, "spk-ghost");
    assert.equal(call.transcript[2].speaker, undefined);
    assert.deepEqual(call.unattributedSpeakerIds, ["spk-ghost"]);
  });

  test("returns the transcript unattributed (with a note) when parties are unavailable", async () => {
    const result = await attributeTranscripts(client, ["call-orphan"]);
    const call = result.callTranscripts[0];
    assert.deepEqual(call.speakers, {});
    assert.equal(call.transcript[0].speaker, undefined);
    assert.deepEqual(call.unattributedSpeakerIds, ["x"]);
    assert.match(result.note ?? "", /could not be resolved/i);
  });

  test("keeps speaker maps per-call (no cross-call leakage on shared speakerId values)", async () => {
    const result = await attributeTranscripts(client, ["call-1", "call-2"]);
    const byId = new Map(result.callTranscripts.map((c) => [c.callId, c]));
    // Same speakerId "spk-nikki" resolves to different people on different calls.
    assert.equal(byId.get("call-1")!.transcript[0].speaker!.name, "Nikki Mitchell");
    assert.equal(byId.get("call-2")!.transcript[0].speaker!.name, "Different Person");
  });
});

describe("attributeTranscripts under policy", () => {
  test("an unrestricted policy fetches parties exactly once (no double-fetch)", async () => {
    const scoped = new PolicyGongClient(SELF as any, policy());
    const result = await attributeTranscripts(scoped, ["call-1"]);
    assert.equal(result.callTranscripts[0].transcript[0].speaker!.name, "Nikki Mitchell");
    assert.equal(transcriptRequests().length, 1);
    assert.equal(extensiveRequests().length, 1);
  });

  test("a restricted policy denies a hidden call, failing closed before the roster fetch", async () => {
    // SELF (504 / member@gonimbly.com) is not a party on call-1 → hidden.
    const restricted = new PolicyGongClient(SELF as any, policy({ calls: { level: "report-to-them", visibleUserIds: new Set([SELF.userId]) } }));
    await assert.rejects(() => attributeTranscripts(restricted, ["call-1"]), AccessDeniedError);
    // The deny happens inside the transcript gate's visibility check (one extensive
    // fetch); the transcript itself is never fetched, and no roster fetch follows.
    assert.equal(transcriptRequests().length, 0);
    assert.equal(extensiveRequests().length, 1);
  });
});
