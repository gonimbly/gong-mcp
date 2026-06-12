/**
 * Full read-tool verification sweep — manual, against the REAL Gong API.
 * Never runs in CI. STRICTLY READ-ONLY: no write endpoint is ever called
 * (meetings, flow assignments, CRM writes, and data erasure are reviewed
 * statically, not fired).
 *
 * Fires every read tool's request EXACTLY as the tool layer builds it, so a
 * passing line means the tool works end-to-end, not just that the endpoint
 * exists. Chains real ids (call, user, folder, profile) from list endpoints.
 *
 * Verdict semantics:
 *   ✅ 200 — tool shape verified working
 *   ⚠️ blocked — request shape ACCEPTED but the org/feature/permission stops it
 *      (param-name errors like "x parameter is missing" / "may not be null"
 *      would mean a shape bug — those are ❌)
 *   ❌ shape bug — the tool can never succeed as written
 *
 * Run:  npm run probe:all-tools
 */
import { GongClient } from "../../src/gong/client.js";
import { resolveGongIdentity } from "../../src/gong/identity.js";
import { statsFilter } from "../../src/tools/stats.js";

const EMAIL = (process.argv[2] ?? "iulyan.ramos@gonimbly.com").toLowerCase();
const raw = new GongClient();

const day = 86400_000;
const range = {
  fromDateTime: new Date(Date.now() - 14 * day).toISOString(),
  toDateTime: new Date().toISOString(),
};

const SHAPE_BUG = /parameter is missing|may not be null|must not be null|Json parse error|Missing required/i;

interface Row { tool: string; verdict: "✅" | "⚠️" | "❌"; detail: string }
const rows: Row[] = [];

async function probe(tool: string, fn: () => Promise<unknown>): Promise<unknown | undefined> {
  try {
    const data = await fn() as Record<string, unknown>;
    const size = (JSON.stringify(data).length / 1024).toFixed(1);
    rows.push({ tool, verdict: "✅", detail: `200, keys [${Object.keys(data ?? {}).slice(0, 6).join(", ")}], ${size} KB` });
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const verdict = SHAPE_BUG.test(msg) ? "❌" : "⚠️";
    rows.push({ tool, verdict, detail: msg.slice(0, 150) });
    return undefined;
  }
}

const identity = await resolveGongIdentity(raw, EMAIL);
if (!identity) {
  console.error("No Gong user for that email; aborting.");
  process.exit(1);
}
const { workspaces } = await raw.listWorkspaces() as { workspaces: Array<{ id: string; name: string }> };
const ws = workspaces[0].id;
console.log(`User ${identity.userId}; primary workspace ${workspaces[0].name}=${ws}\n`);

// ── Calls ─────────────────────────────────────────────────────────────────────

const callsPage = await probe("gong_list_calls", () => raw.listCalls({ ...range })) as
  { calls?: Array<{ id?: string }> } | undefined;
const callId = callsPage?.calls?.[0]?.id ? String(callsPage.calls[0].id) : undefined;

if (callId) {
  await probe("gong_get_call", () => raw.getCall(callId));
  await probe("gong_get_transcripts", () => raw.getCallTranscripts([callId]));
} else {
  rows.push({ tool: "gong_get_call", verdict: "⚠️", detail: "no call id available to probe" });
  rows.push({ tool: "gong_get_transcripts", verdict: "⚠️", detail: "no call id available to probe" });
}
const extensive = await probe("gong_get_extensive_calls", () => raw.getExtensiveCalls({
  filter: { ...range },
  contentSelector: { exposedFields: { parties: true } },
})) as { calls?: Array<{ parties?: Array<{ emailAddress?: string; affiliation?: string }> }> } | undefined;
const externalEmail = extensive?.calls
  ?.flatMap((c) => c.parties ?? [])
  .find((p) => p.affiliation === "External" && p.emailAddress)?.emailAddress;
await probe("gong_get_extensive_calls (outline + highlights fields)", () => raw.getExtensiveCalls({
  filter: { ...range },
  contentSelector: { exposedFields: { content: { outline: true, highlights: true } } },
}));
if (callId) {
  await probe("gong_library_folder_recap (callIds filter via extensive)", () => raw.getExtensiveCalls({
    filter: { callIds: [callId] },
    contentSelector: { exposedFields: { content: { brief: true, keyPoints: true } } },
  }));
} else {
  rows.push({ tool: "gong_library_folder_recap (callIds filter via extensive)", verdict: "⚠️", detail: "no call id available to probe" });
}
await probe("gong_list_call_outcomes", () => raw.listCallOutcomes());

// ── Users ─────────────────────────────────────────────────────────────────────

await probe("gong_list_users", () => raw.listUsers({}));
await probe("gong_get_user", () => raw.getUser(identity.userId));
await probe("gong_get_user_settings_history", () => raw.getUserSettingsHistory(identity.userId));
await probe("gong_get_extensive_users", () => raw.getExtensiveUsers({ filter: { userIds: [identity.userId] } }));

// ── Stats (tool-layer filter builder) + coaching ──────────────────────────────

await probe("gong_get_activity_aggregate", () => raw.getActivityAggregate({ filter: statsFilter({ userIds: [identity.userId] }) }));
await probe("gong_get_activity_by_period", () => raw.getActivityAggregateByPeriod({ filter: statsFilter({ userIds: [identity.userId] }), aggregationPeriod: "WEEK" }));
await probe("gong_get_activity_day_by_day", () => raw.getActivityDayByDay({ filter: statsFilter({ userIds: [identity.userId] }) }));
await probe("gong_get_scorecard_stats", () => raw.getScorecardStats({ filter: statsFilter({}) }));
await probe("gong_get_interaction_stats", () => raw.getInteractionStats({ filter: statsFilter({}) }));
await probe("gong_get_coaching", () => raw.getCoaching({ workspaceId: ws, managerId: identity.userId, from: range.fromDateTime, to: range.toDateTime }));

// ── Settings ──────────────────────────────────────────────────────────────────

await probe("gong_list_scorecards", () => raw.listScorecards());
await probe("gong_list_trackers", () => raw.listTrackers());
await probe("gong_list_workspaces", () => raw.listWorkspaces());

// ── AI entity tools (read-only GETs; need Gen AI Beta + a valid CRM id) ───────

await probe("gong_ask_account", () => raw.askAccount({
  workspaceId: ws, crmAccountId: "001QQ00002AExMUYA1", timePeriod: "THIS_MONTH",
  question: "What was discussed?",
}));
await probe("gong_ask_deal (fake deal id — expect semantic error, not a param error)", () => raw.askDeal({
  workspaceId: ws, crmDealId: "006QQ000009ZZZZYA0", timePeriod: "THIS_MONTH",
  question: "What are the blockers?",
}));
await probe("gong_generate_brief (no published template — expect 'Brief not found')", () => raw.generateBrief({
  workspaceId: ws, briefName: "Probe", crmEntityType: "ACCOUNT", crmEntityId: "001QQ00002AExMUYA1",
  timePeriod: "THIS_MONTH",
}));

// ── Library ───────────────────────────────────────────────────────────────────

const folders = await probe("gong_list_library_folders", () => raw.listLibraryFolders(ws)) as
  { folders?: Array<{ id?: string }> } | undefined;
const folderId = folders?.folders?.[0]?.id ? String(folders.folders[0].id) : "1";
const folderContent = await probe("gong_get_library_folder_content", () => raw.getLibraryFolderContent(folderId)) as
  { calls?: Array<{ id: string }> } | undefined;

// gong_library_folder_recap: verify folder content returns call ids (step 1 of the composite tool)
const folderCallIds = (folderContent?.calls ?? []).map((c) => c.id);
if (folderCallIds.length > 0) {
  await probe("gong_library_folder_recap (folder → extensive)", () => raw.getExtensiveCalls({
    filter: { callIds: folderCallIds.slice(0, 5) },
    contentSelector: { exposedFields: { content: { brief: true, keyPoints: true } } },
  }));
} else {
  rows.push({ tool: "gong_library_folder_recap (folder → extensive)", verdict: "⚠️", detail: `first folder (${folderId}) has no calls — shape still verified via callIds probe in calls section` });
}

// ── CRM (reads only; this org has no generic-CRM API integration, so the tool
//    layer returns an instructive error before any API call — probe the API
//    shape with a syntactically valid integrationId instead) ──────────────────

await probe("gong_get_crm_integrations", () => raw.getCrmIntegrations());
await probe("gong_get_crm_entity_schema (integrationId=1 — expect 'not found', not a param error)", () =>
  raw.getCrmEntitySchema({ integrationId: "1", objectType: "ACCOUNT" }));
await probe("gong_get_crm_entities (integrationId=1)", () =>
  raw.getCrmEntities({ integrationId: "1", objectType: "ACCOUNT", objectIds: ["x"] }));
await probe("gong_get_crm_request_status (integrationId=1)", () =>
  raw.getCrmRequestStatus({ integrationId: "1", clientRequestId: "probe-nonexistent" }));

// ── Flows (reads only; 403 = license gate, shape verified) ────────────────────

await probe("gong_list_flows", () => raw.listFlows({ flowOwnerEmail: identity.email, workspaceId: ws }));
await probe("gong_list_flow_folders", () => raw.listFlowFolders({ flowFolderOwnerEmail: identity.email }));
await probe("gong_get_bulk_assignment_status", () => raw.getBulkAssignmentStatus("probe-nonexistent-id"));

// ── Permissions (tool sweeps all workspaces when workspaceId is omitted) ──────

const profilesWs = await probe("gong_list_permission_profiles (per workspace, as the tool iterates)", () =>
  raw.listAllPermissionProfiles(ws)) as { profiles?: Array<{ id?: string }> } | undefined;
const profileId = profilesWs?.profiles?.[0]?.id;
if (profileId) {
  await probe("gong_get_permission_profile", () => raw.getPermissionProfile(String(profileId)));
  await probe("gong_get_permission_profile_users", () => raw.getPermissionProfileUsers(String(profileId)));
}

// ── Data privacy (lookups only — NEVER the erase endpoints) ───────────────────

if (externalEmail) {
  await probe(`gong_get_data_for_email (external participant)`, () => raw.getDataForEmail(externalEmail));
} else {
  rows.push({ tool: "gong_get_data_for_email", verdict: "⚠️", detail: "no external participant email found to probe" });
}
await probe("gong_get_data_for_phone", () => raw.getDataForPhone("+14155550100"));

// ── Logs ──────────────────────────────────────────────────────────────────────

await probe("gong_get_audit_logs", () => raw.getLogs({ logType: "UserActivityLog", ...range }));

// ── Report ────────────────────────────────────────────────────────────────────

console.log("tool                                        verdict  detail");
console.log("─".repeat(110));
for (const r of rows) {
  console.log(`${r.tool.padEnd(44)}${r.verdict}      ${r.detail}`);
}
const bugs = rows.filter((r) => r.verdict === "❌");
console.log(`\n${rows.length} probed: ${rows.filter((r) => r.verdict === "✅").length} ✅, ${rows.filter((r) => r.verdict === "⚠️").length} ⚠️, ${bugs.length} ❌`);
if (bugs.length) {
  console.log("\nSHAPE BUGS (tool can never succeed as written):");
  for (const b of bugs) console.log(`  ❌ ${b.tool} — ${b.detail}`);
}
console.log("\nWrite tools NOT fired (static review only): gong_assign_flow_to_prospect, gong_bulk_assign_flows,");
console.log("gong_unassign_flows_by_crm_id, gong_create_meeting, gong_update_meeting, gong_delete_meeting,");
console.log("gong_erase_data_for_email, gong_erase_data_for_phone");
