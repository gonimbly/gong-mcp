/**
 * Live diagnostic — manual, against the REAL Gong API. Never runs in CI.
 *
 * Reproduces the "account query collapses to my calls" report (Drake Senter,
 * account "BillingPlatform"): with the org credential we cannot impersonate the
 * user in Gong, but we CAN reconstruct exactly what the MCP grants him and diff
 * it against the unfiltered truth set — then classify WHY calls are dropped.
 *
 *   1. resolve the user's policy (his MCP visible set, per workspace)
 *   2. pull ALL matching calls unfiltered (raw org client)
 *   3. pull his filtered view (PolicyGongClient) → which calls are dropped
 *   4. for each dropped call, are its internal hosts within his reporting tree?
 *        - hosts IN his tree / his set should be ~1  → Branch A (resolver collapse)
 *        - hosts OUTSIDE his tree                     → Branch B (account-team gap)
 *   5. best-effort: dump the call's CRM context + account team (may be native SF,
 *      not introspectable via the generic CRM API — noted, not fatal)
 *
 * Read-only — no write endpoint is ever called.
 *
 * Run:  npx tsx tests/manual/account-visibility-probe.ts
 *       npx tsx tests/manual/account-visibility-probe.ts "Drake Senter" "BillingPlatform"
 */
import { GongClient } from "../../src/gong/client.js";
import { PolicyGongClient } from "../../src/gong/policyClient.js";
import { PermissionResolver } from "../../src/gong/permissionResolver.js";
import { loadUserDirectory, matchDirectoryUsers, type DirectoryUser } from "../../src/gong/directory.js";
import { findCalls, type CompactCall } from "../../src/gong/discovery.js";

const NAME = process.argv[2] ?? "Drake Senter";
const ACCOUNT = process.argv[3] ?? "BillingPlatform";
const MAX_PAGES = 10; // 1000 calls scanned per pass — the discovery default cap

function hr(label: string) {
  console.log(`\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}`);
}

/** Walk a user's manager chain to the root, returning the ordered ancestor ids. */
function managerChain(userId: string, managerOf: Map<string, string>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = managerOf.get(userId);
  while (cur && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = managerOf.get(cur);
  }
  return chain;
}

async function main() {
  const raw = new GongClient();

  // ── 1. Resolve the target user from the directory ────────────────────────
  hr(`Target: "${NAME}"   Account query: "${ACCOUNT}"`);
  const dir = await loadUserDirectory(raw);
  const byId = new Map(dir.map((u) => [u.userId, u] as const));
  const managerOf = new Map<string, string>();
  for (const u of dir) if (u.managerId) managerOf.set(u.userId, u.managerId);

  const matches = matchDirectoryUsers(dir, NAME);
  if (matches.length === 0) throw new Error(`No Gong user matches "${NAME}"`);
  if (matches.length > 1) {
    console.log("Multiple matches — using the first:");
    for (const m of matches) console.log(`  ${m.userId}  ${m.fullName}  ${m.email}`);
  }
  const user = matches[0];
  console.log(`userId=${user.userId}  email=${user.email}  title=${user.title ?? "?"}`);
  console.log(`manager chain: ${managerChain(user.userId, managerOf).map((id) => byId.get(id)?.fullName ?? id).join(" → ") || "(none)"}`);

  // ── 2. Resolve his MCP policy (mimic his access) ─────────────────────────
  hr("Resolved policy (what the MCP grants him)");
  const resolver = new PermissionResolver(raw);
  const policy = await resolver.resolvePolicy(user.userId, user.email);
  console.log(`degraded: ${policy.degraded}`);
  for (const [wsId, ws] of policy.perWorkspace) {
    const v = ws.calls.visibleUserIds;
    console.log(
      `  ws ${wsId}  profile="${ws.profileName}"  callsAccess=${ws.calls.level}  ` +
      `visible=${v === null ? "UNRESTRICTED" : `${v.size} users`}`
    );
  }
  const policyClient = new PolicyGongClient({ userId: user.userId, email: user.email }, policy);

  // ── 3. Unfiltered truth set vs his filtered view ─────────────────────────
  hr(`Account "${ACCOUNT}" calls: unfiltered (org) vs filtered (his policy)`);
  const opts = { account: ACCOUNT, maxPages: MAX_PAGES };
  const truth = await findCalls(raw, opts);
  const mine = await findCalls(policyClient, opts);
  const mineIds = new Set(mine.calls.map((c) => c.id));
  const dropped = truth.calls.filter((c) => !mineIds.has(c.id));

  console.log(`unfiltered matched: ${truth.calls.length}  (coverage: ${JSON.stringify(truth.coverage)})`);
  console.log(`visible to him:     ${mine.calls.length}`);
  console.log(`DROPPED by policy:  ${dropped.length}`);
  if (mine.policyNote) console.log(`policyNote: ${mine.policyNote}`);

  // ── 4. Classify the dropped calls by host reachability ───────────────────
  hr("Dropped calls — who hosts them, and are they in his visible set?");
  const visibleByWs = (wsId?: string) => {
    const ws = (wsId && policy.perWorkspace.get(wsId)) || policy.perWorkspace.get("*");
    return ws?.calls.visibleUserIds ?? null;
  };
  const internalHosts = new Set<string>();
  for (const c of dropped.slice(0, 20)) {
    const visible = visibleByWs(c.workspaceId);
    const internal = c.participants.filter((p) => p.affiliation === "Internal" && p.userId);
    for (const p of internal) if (p.userId) internalHosts.add(p.userId);
    const primary = c.primaryUserId ? byId.get(c.primaryUserId) : undefined;
    console.log(`\n• ${c.started?.slice(0, 10)}  ws=${c.workspaceId}  "${c.title}"`);
    console.log(`    primary host: ${primary?.fullName ?? c.primaryUserId} (${c.primaryUserId})`);
    console.log(`    internal parties: ${internal.map((p) => `${p.name ?? p.userId}#${p.userId}`).join(", ") || "(none linked)"}`);
    console.log(`    in his visible set? ${visible === null ? "n/a (unrestricted)" : internal.some((p) => p.userId && visible.has(p.userId))}`);
  }

  hr("Distinct internal hosts of dropped calls — reporting relationship to him");
  const drakeReports = (() => {
    // Transitive reports of the user, derived from the directory manager graph.
    const children = new Map<string, string[]>();
    for (const [child, mgr] of managerOf) (children.get(mgr) ?? children.set(mgr, []).get(mgr)!).push(child);
    const out = new Set<string>(), stack = [user.userId];
    while (stack.length) for (const ch of children.get(stack.pop()!) ?? []) if (!out.has(ch)) { out.add(ch); stack.push(ch); }
    return out;
  })();
  for (const hostId of internalHosts) {
    const h = byId.get(hostId);
    const chain = managerChain(hostId, managerOf);
    const rel = drakeReports.has(hostId) ? "REPORTS TO HIM"
      : chain.includes(user.userId) ? "reports to him (chain)"
      : "outside his reporting tree";
    console.log(`  ${hostId}  ${h?.fullName ?? "?"}  (${h?.title ?? "?"})  → ${rel}`);
    console.log(`     mgr chain: ${chain.map((id) => byId.get(id)?.fullName ?? id).join(" → ") || "(none)"}`);
  }

  // ── 5. Best-effort account-team / CRM context dump ───────────────────────
  hr("CRM context on a dropped call (best-effort — may be native SF, not introspectable)");
  const sample = dropped[0];
  if (sample) {
    console.log(`Sample dropped call ${sample.id} CRM account label: ${sample.account ?? "(none surfaced)"}`);
    console.log("Note: account-TEAM membership (who in Gong is granted the account) is not exposed");
    console.log("on the call payload; getCrmEntities only covers generic-CRM-API integrations.");
    try {
      const integrations = await raw.getCrmIntegrations();
      console.log(`getCrmIntegrations → ${JSON.stringify(integrations).slice(0, 300)}`);
    } catch (e) {
      console.log(`getCrmIntegrations failed (expected if native SF): ${(e as Error).message}`);
    }
  } else {
    console.log("No dropped calls — nothing to sample.");
  }

  // ── Verdict hint ─────────────────────────────────────────────────────────
  hr("Classification hint");
  const allOutside = [...internalHosts].every((id) => !drakeReports.has(id) && !managerChain(id, managerOf).includes(user.userId));
  if (dropped.length === 0) {
    console.log("No calls dropped — his policy already sees the full account set. Look elsewhere (tool selection?).");
  } else if (allOutside) {
    console.log("Branch B (account-team gap): every dropped host is OUTSIDE his reporting tree.");
    console.log("The reporting-tree model cannot see these; he sees them in Gong via account/deal team.");
  } else {
    console.log("Branch A (resolver collapse): some dropped hosts ARE in his reporting tree —");
    console.log("his visible set is narrower than his profile should grant. Fix the resolver.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
