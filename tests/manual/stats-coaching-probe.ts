/**
 * Live probe of the stats + coaching endpoints — manual, against the REAL Gong
 * API. Never runs in CI. Read-only.
 *
 * Exists because production surfaced tool-layer 400s on 2026-06-12:
 *   - stats tools sent filter.fromDateTime/toDateTime where the API wants
 *     date-only filter.fromDate/toDate ("filter.fromDate: may not be null")
 *   - GET /v2/coaching rejected our params outright ("workspace-id parameter
 *     is missing") — the client never sent workspace-id/manager-id at all
 *
 * This probe pins each endpoint's actual required shape so the tool schemas
 * and client methods can be fixed against reality, not docs-from-memory.
 *
 * Run:  npm run probe:stats-coaching
 */
import { GongClient } from "../../src/gong/client.js";
import { resolveGongIdentity } from "../../src/gong/identity.js";

const EMAIL = (process.argv[2] ?? "iulyan.ramos@gonimbly.com").toLowerCase();
const ORG_ROOT_MANAGER = "2830045931589947630"; // known manager (org-chart root)

const raw = new GongClient();

const day = 86400_000;
// Stats endpoints reject dates past "today" in the org TZ — end at yesterday.
const dates = {
  fromDate: new Date(Date.now() - 30 * day).toISOString().slice(0, 10),
  toDate: new Date(Date.now() - day).toISOString().slice(0, 10),
};
const isoRange = {
  fromDateTime: new Date(Date.now() - 30 * day).toISOString(),
  toDateTime: new Date().toISOString(),
};

const identity = await resolveGongIdentity(raw, EMAIL);
if (!identity) {
  console.error("No Gong user for that email; aborting.");
  process.exit(1);
}
const { workspaces } = await raw.listWorkspaces() as { workspaces: Array<{ id: string; name: string }> };
console.log(`User ${identity.userId}; workspaces: ${workspaces.map((w) => `${w.name}=${w.id}`).join(", ")}`);

async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const data = await fn() as Record<string, unknown>;
    const keys = Object.keys(data ?? {}).join(", ");
    console.log(`  ✅ ${label} — 200, keys: [${keys}] (${(JSON.stringify(data).length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.log(`  ❌ ${label} — ${err instanceof Error ? err.message.slice(0, 180) : err}`);
  }
}

console.log(`\n— A. /v2/stats/activity/aggregate —`);
await probe("date-only fromDate/toDate", () => raw.getActivityAggregate({ filter: { ...dates } }));
await probe("ISO fromDateTime/toDateTime (prod bug shape)", () => raw.getActivityAggregate({ filter: { ...isoRange } }));
await probe("with userIds=[me]", () => raw.getActivityAggregate({ filter: { ...dates, userIds: [identity.userId] } }));
await probe("with workspaceId", () => raw.getActivityAggregate({ filter: { ...dates, workspaceId: workspaces[0].id } }));

console.log(`\n— B. /v2/stats/activity/aggregate-by-period —`);
// The "aggregationPeriod: must not be null" error has no "filter." prefix —
// suggesting it is a TOP-LEVEL body field, sibling of filter.
type ByPeriodBody = { filter: Record<string, unknown> } & Record<string, unknown>;
const byPeriod = (body: ByPeriodBody) =>
  raw.getActivityAggregateByPeriod(body as { filter: Record<string, unknown> });
// "Json parse error" on an unknown enum value is Jackson's failure mode — the
// top-level placement is likely right and the VALUE casing wrong.
for (const value of ["WEEK", "MONTH", "DAY", "QUARTER"]) {
  await probe(`top-level aggregationPeriod: "${value}"`, () =>
    byPeriod({ filter: { ...dates }, aggregationPeriod: value }));
}

console.log(`\n— C. /v2/stats/activity/day-by-day —`);
await probe("date-only fromDate/toDate", () => raw.getActivityDayByDay({ filter: { ...dates } }));

console.log(`\n— D. /v2/stats/activity/scorecards —`);
await probe("date-only fromDate/toDate", () => raw.getScorecardStats({ filter: { ...dates } }));

console.log(`\n— E. /v2/stats/interaction —`);
await probe("dates + userIds=[me]", () => raw.getInteractionStats({ filter: { ...dates, userIds: [identity.userId] } }));
await probe("dates only", () => raw.getInteractionStats({ filter: { ...dates } }));

console.log(`\n— F. GET /v2/coaching —`);
const coach = (params: Record<string, string>) =>
  (raw as unknown as { request: (p: string) => Promise<unknown> })
    ? fetchCoaching(params)
    : Promise.reject(new Error("unreachable"));

async function fetchCoaching(params: Record<string, string>): Promise<unknown> {
  // Hit the endpoint directly so we control the exact query-param names.
  const qs = new URLSearchParams(params).toString();
  const base = process.env.GONG_BASE_URL ?? "https://api.gong.io";
  const { GongApiError } = await import("../../src/gong/client.js");
  // Reuse the client's auth by calling its private request via a thin subclass.
  class P extends GongClient {
    probeGet(path: string) {
      return (this as unknown as { request: (p: string) => Promise<unknown> }).request(path);
    }
  }
  void base; void GongApiError;
  return new P().probeGet(`/v2/coaching${qs ? `?${qs}` : ""}`);
}

await probe("bare (no params)", () => coach({}));
await probe("workspace-id only", () => coach({ "workspace-id": workspaces[0].id }));
const wsAndMgr = { "workspace-id": workspaces[0].id, "manager-id": ORG_ROOT_MANAGER };
await probe("ws + mgr, from=date-only", () => coach({ ...wsAndMgr, from: dates.fromDate }));
await probe("ws + mgr, from+to date-only", () => coach({ ...wsAndMgr, from: dates.fromDate, to: dates.toDate }));
await probe("ws + mgr, from+to ISO datetime", () =>
  coach({ ...wsAndMgr, from: isoRange.fromDateTime, to: isoRange.toDateTime }));
await probe("manager-id=me (not a manager)", () =>
  coach({ "workspace-id": workspaces[0].id, "manager-id": identity.userId, from: dates.fromDate, to: dates.toDate }));

console.log("\nDone. Fix src/tools/stats.ts + settings.ts + client.getCoaching against these findings.");
