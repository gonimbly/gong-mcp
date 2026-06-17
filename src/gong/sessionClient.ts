/**
 * Gateway session wiring: GONG_POLICY_MODE parsing and the policy-mode →
 * client dispatch (break-glass admins, fail-closed degradation, shadow
 * instrumentation). Extracted from server.ts so the access-model routing is
 * unit-testable without booting the HTTP server.
 */
import type { GongClient } from "./client.js";
import { ScopedGongClient, type GatewayRole } from "./scopedClient.js";
import { PolicyGongClient } from "./policyClient.js";
import {
  degradedPolicy,
  summarizeWorkspaceAccess,
  VISIBILITY_CAVEAT,
  type UserPolicy,
  type WorkspaceAccess,
} from "./permissionResolver.js";
import { shadowGongClient } from "./policyShadow.js";
import type { GongIdentity } from "./identity.js";

//  profiles — enforce the user's Gong permission profile (default)
//  binary   — Phase 2 admin/member model (rollback path — set explicitly)
//  shadow   — enforce binary, log every place the profile-based policy disagrees
export type PolicyMode = "binary" | "shadow" | "profiles";

export function parsePolicyMode(raw: string | undefined): PolicyMode {
  // `||` not `??`: an env var saved as an empty string must mean the default, not a boot failure
  const mode = raw || "profiles";
  if (mode === "binary" || mode === "shadow" || mode === "profiles") return mode;
  throw new Error(`Invalid GONG_POLICY_MODE "${mode}" — expected binary | shadow | profiles`);
}

/** The one PermissionResolver method sessions need — narrow so tests can fake it. */
export interface PolicyResolver {
  resolvePolicy(userId: string, email: string): Promise<UserPolicy>;
}

/**
 * Resolve the user's profile policy, failing CLOSED: any resolver error
 * degrades to the Phase 2 member policy (own data only), never to open access.
 */
async function resolveUserPolicy(resolver: PolicyResolver, identity: GongIdentity): Promise<UserPolicy> {
  try {
    return await resolver.resolvePolicy(identity.userId, identity.email);
  } catch (err) {
    console.error(
      `[policy] DEGRADED ${identity.email} to the Phase 2 member policy: ` +
      `${err instanceof Error ? err.message : err}`
    );
    return degradedPolicy(identity.userId, identity.email);
  }
}

/**
 * Structured access detail for the gateway's gong_whoami tool — lets a user see
 * why their MCP call visibility may differ from the Gong UI. `headline` is the
 * same string as `access`; `workspaces`/`note` are populated only in profiles mode.
 */
export interface AccessSummary {
  headline: string;
  mode: "admin" | "member" | "profiles" | "degraded";
  workspaces?: WorkspaceAccess[];
  note?: string;
}

export async function buildSessionClient(
  identity: GongIdentity,
  role: GatewayRole,
  policyMode: PolicyMode,
  resolver: PolicyResolver
): Promise<{ client: GongClient; access: string; accessSummary: AccessSummary }> {
  const binaryAccess = role === "admin"
    ? "admin (org-wide data)"
    : "member — calls and stats are limited to your own activity";
  const binarySummary: AccessSummary = { headline: binaryAccess, mode: role === "admin" ? "admin" : "member" };

  // Break-glass admins keep org-wide passthrough in every mode
  if (policyMode === "binary" || (policyMode === "profiles" && role === "admin")) {
    return { client: new ScopedGongClient(identity, role), access: binaryAccess, accessSummary: binarySummary };
  }

  const policy = await resolveUserPolicy(resolver, identity);

  if (policyMode === "shadow") {
    const binary = new ScopedGongClient(identity, role);
    return {
      client: shadowGongClient(binary, identity, role, policy.degraded ? null : policy),
      access: binaryAccess,
      accessSummary: binarySummary,
    };
  }

  if (policy.degraded) {
    const access = "member (fallback) — your Gong permission profile could not be resolved, so access is limited to your own activity";
    return { client: new PolicyGongClient(identity, policy), access, accessSummary: { headline: access, mode: "degraded" } };
  }

  const profileNames = [...policy.perWorkspace.values()].map((ws) => ws.profileName).join("; ");
  const access = `mirrors your Gong permission profile (${profileNames})`;
  return {
    client: new PolicyGongClient(identity, policy),
    access,
    accessSummary: { headline: access, mode: "profiles", workspaces: summarizeWorkspaceAccess(policy), note: VISIBILITY_CAVEAT },
  };
}
