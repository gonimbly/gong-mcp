/**
 * Live diagnostic — can a MANAGER see a direct REPORT's calls through the MCP?
 * Resolves the manager's policy, checks whether the report's userId is in the
 * manager's visible set, then compares the report's calls (unfiltered) against
 * what the manager's PolicyGongClient actually returns. Read-only.
 *
 * Run: npx tsx tests/manual/manager-report-visibility-probe.ts [managerName] [reportName|reportUserId]
 */
import { GongClient } from "../../src/gong/client.js";
import { PolicyGongClient } from "../../src/gong/policyClient.js";
import { PermissionResolver } from "../../src/gong/permissionResolver.js";
import { loadUserDirectory, matchDirectoryUsers } from "../../src/gong/directory.js";
import { findCalls } from "../../src/gong/discovery.js";

const MANAGER = process.argv[2] ?? "Emiliano";
const REPORT = process.argv[3] ?? "4258249592143210109"; // Iulyan Vicari
const MAX_PAGES = 10;

function hr(s: string) { console.log(`\n${"─".repeat(72)}\n${s}\n${"─".repeat(72)}`); }

async function main() {
  const raw = new GongClient();
  const dir = await loadUserDirectory(raw);
  const byId = new Map(dir.map((u) => [u.userId, u] as const));

  const mgrMatch = matchDirectoryUsers(dir, MANAGER);
  if (mgrMatch.length === 0) throw new Error(`No Gong user matches manager "${MANAGER}"`);
  const mgr = mgrMatch[0];
  const report = byId.get(REPORT) ?? matchDirectoryUsers(dir, REPORT)[0];
  if (!report) throw new Error(`No Gong user matches report "${REPORT}"`);

  hr("Who");
  console.log(`Manager: ${mgr.fullName} <${mgr.email}> #${mgr.userId} (${mgr.title ?? "?"})`);
  console.log(`Report:  ${report.fullName} <${report.email}> #${report.userId} (${report.title ?? "?"})`);
  console.log(`Report's manager per directory: ${report.managerId ? (byId.get(report.managerId)?.fullName ?? report.managerId) : "(none)"}` +
    `  → ${report.managerId === mgr.userId ? "MANAGER IS DIRECT MANAGER ✓" : "not the direct manager"}`);

  hr("Manager's resolved policy — is the report in his visible set?");
  const policy = await new PermissionResolver(raw).resolvePolicy(mgr.userId, mgr.email);
  console.log(`degraded: ${policy.degraded}`);
  for (const [wsId, ws] of policy.perWorkspace) {
    const v = ws.calls.visibleUserIds;
    const has = v === null ? "n/a (unrestricted)" : v.has(report.userId);
    console.log(`  ws ${wsId}  profile="${ws.profileName}"  callsAccess=${ws.calls.level}  ` +
      `visible=${v === null ? "UNRESTRICTED" : `${v.size} users`}  reportInSet=${has}`);
  }
  const mgrClient = new PolicyGongClient({ userId: mgr.userId, email: mgr.email }, policy);

  hr(`Report's calls: unfiltered (org) vs what the manager can see`);
  const opts = { participant: report.userId, maxPages: MAX_PAGES };
  const truth = await findCalls(raw, opts);
  const mgrView = await findCalls(mgrClient, opts);
  const mgrIds = new Set(mgrView.calls.map((c) => c.id));
  const hidden = truth.calls.filter((c) => !mgrIds.has(c.id));

  console.log(`report's calls (unfiltered): ${truth.calls.length}  (coverage ${JSON.stringify(truth.coverage)})`);
  console.log(`visible to the manager:      ${mgrView.calls.length}`);
  console.log(`hidden from the manager:     ${hidden.length}`);

  hr("Sample of the report's calls the manager CAN see");
  for (const c of mgrView.calls.slice(0, 8)) {
    console.log(`  ✓ ${c.started?.slice(0, 10)}  "${c.title}"  (host ${byId.get(c.primaryUserId ?? "")?.fullName ?? c.primaryUserId})`);
  }
  if (hidden.length) {
    hr("Report's calls HIDDEN from the manager (with reason)");
    for (const c of hidden.slice(0, 8)) {
      console.log(`  ✗ ${c.started?.slice(0, 10)}  "${c.title}"  ws=${c.workspaceId}`);
    }
  }

  hr("Verdict");
  if (mgrView.calls.length > 0 && hidden.length === 0) {
    console.log(`${mgr.fullName} (manager) CAN see ${report.fullName}'s calls — reporting-tree visibility works as intended.`);
  } else if (mgrView.calls.length > 0) {
    console.log(`Manager sees ${mgrView.calls.length} of ${truth.calls.length} — ${hidden.length} hidden (check workspace/privacy).`);
  } else {
    console.log(`Manager sees NONE of the report's calls — report is not in his visible set.`);
  }
  console.log(`Note: Gong per-call PRIVATE flags are not introspectable via the API; a call the report`);
  console.log(`marked private in the UI may still appear here (documented fidelity delta).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
