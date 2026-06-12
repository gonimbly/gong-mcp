/**
 * Phase 3 shadow mode (GONG_POLICY_MODE=shadow).
 *
 * Enforcement stays on the Phase 2 binary client; this wrapper additionally
 * evaluates what the profile-based policy WOULD have decided for every gated
 * method and logs `[policy] SHADOW diff …` whenever the two models disagree.
 * Zero behavioral impact, no extra Gong API calls — a diagnostic for comparing
 * the two models on live traffic, e.g. while deciding whether a `binary`
 * rollback can be lifted back to `profiles`.
 */
import type { GongClient } from "./client.js";
import type { ScopedGongClient, GatewayRole } from "./scopedClient.js";
import type { GongIdentity } from "./identity.js";
import type { UserPolicy } from "./permissionResolver.js";

type Caps = UserPolicy["capabilities"];

/** Methods the Phase 2 binary model denies to members. */
const MEMBER_DENIED = new Set([
  "createCall", "uploadCallMedia",
  "askAccount", "askDeal", "generateBrief",
  "getUserSettingsHistory", "getExtensiveUsers",
  "upsertCrmEntities", "setCrmEntitySchema",
  "getCrmIntegrations", "updateCrmIntegration", "deleteCrmIntegration",
  "createMeeting", "updateMeeting", "deleteMeeting", "getMeetingIntegrationStatus",
  "listAllPermissionProfiles", "getPermissionProfile", "createPermissionProfile",
  "updatePermissionProfile", "getPermissionProfileUsers",
  "addCallUsersAccess", "updateCallUsersAccess", "deleteCallUsersAccess",
  "addProspectsToFlow", "assignFlowToProspect", "assignFlowCoolOffOverride",
  "bulkAssignFlows", "unassignFlowsByCrmId", "unassignFlowsByInstanceId",
  "logDigitalInteraction", "updateIntegrationSettings",
  "recordCustomerEngagementAction", "recordContentShared", "recordContentViewed",
  "createTask", "updateTask",
  "getDataForEmail", "getDataForPhone", "eraseDataForEmail", "eraseDataForPhone",
  "getLogs",
]);

/** What the profile policy would decide for each gated method. */
const PROFILE_GATES: Record<string, (policy: UserPolicy, args: unknown[]) => boolean> = (() => {
  const cap = (flag: keyof Caps) => (policy: UserPolicy) => policy.capabilities[flag];
  const dealsRead = (policy: UserPolicy) =>
    [...policy.perWorkspace.values()].some((ws) => ws.deals.level !== "none");
  const allCallsInWorkspace = (policy: UserPolicy, args: unknown[]) => {
    const workspaceId = (args[0] as { workspaceId?: string } | undefined)?.workspaceId;
    const ws = workspaceId
      ? policy.perWorkspace.get(workspaceId) ?? policy.perWorkspace.get("*")
      : undefined;
    if (workspaceId && ws) return ws.calls.visibleUserIds === null;
    return [...policy.perWorkspace.values()].every((w) => w.calls.visibleUserIds === null);
  };

  const gates: Record<string, (policy: UserPolicy, args: unknown[]) => boolean> = {
    createCall: cap("scheduleCalls"),
    uploadCallMedia: cap("scheduleCalls"),
    createMeeting: cap("scheduleCalls"),
    updateMeeting: cap("scheduleCalls"),
    deleteMeeting: cap("scheduleCalls"),
    upsertCrmEntities: cap("crmWrite"),
    setCrmEntitySchema: cap("crmWrite"),
    getCrmEntities: dealsRead,
    getCrmEntitySchema: dealsRead,
    getCrmRequestStatus: dealsRead,
    askAccount: allCallsInWorkspace,
    askDeal: allCallsInWorkspace,
    generateBrief: allCallsInWorkspace,
    listLibraryFolders: (p) => [...p.perWorkspace.values()].some((ws) => ws.library.level !== "none"),
  };
  for (const method of [
    "getUserSettingsHistory", "getExtensiveUsers",
    "getCrmIntegrations", "updateCrmIntegration", "deleteCrmIntegration",
    "getMeetingIntegrationStatus",
    "listAllPermissionProfiles", "getPermissionProfile", "createPermissionProfile",
    "updatePermissionProfile", "getPermissionProfileUsers",
    "addCallUsersAccess", "updateCallUsersAccess", "deleteCallUsersAccess",
    "addProspectsToFlow", "assignFlowToProspect", "assignFlowCoolOffOverride",
    "bulkAssignFlows", "unassignFlowsByCrmId", "unassignFlowsByInstanceId",
    "logDigitalInteraction", "updateIntegrationSettings",
    "recordCustomerEngagementAction", "recordContentShared", "recordContentViewed",
    "createTask", "updateTask",
    "getDataForEmail", "getDataForPhone", "eraseDataForEmail", "eraseDataForPhone",
    "getLogs",
  ]) {
    gates[method] = cap("techAdmin");
  }
  return gates;
})();

/** Stats methods where binary forces userIds=[self] but profiles use the visible set. */
const STATS_METHODS = new Set([
  "getActivityAggregate", "getActivityAggregateByPeriod", "getActivityDayByDay",
  "getScorecardStats", "getInteractionStats", "getCoaching",
]);

/** Call methods where binary is participant-checked but profiles use the visible set. */
const CALL_METHODS = new Set(["listCalls", "getCall", "getExtensiveCalls", "getCallTranscripts"]);

/**
 * Wrap the enforcing binary client so every gated call also logs what the
 * profile policy would have decided. Returns the client unchanged when no
 * policy could be resolved (that itself is logged by the caller).
 */
export function shadowGongClient(
  binary: ScopedGongClient,
  identity: GongIdentity,
  role: GatewayRole,
  policy: UserPolicy | null
): GongClient {
  if (!policy) return binary;

  const diff = (method: string, message: string) => {
    console.error(`[policy] SHADOW diff ${method} for ${identity.email}: ${message}`);
  };

  return new Proxy(binary, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function" || typeof prop !== "string") return original;
      const method = prop;

      return function (this: unknown, ...args: unknown[]) {
        try {
          const gate = PROFILE_GATES[method];
          if (gate) {
            const binaryAllows = role === "admin" || !MEMBER_DENIED.has(method);
            const profileAllows = gate(policy, args);
            if (binaryAllows !== profileAllows) {
              diff(method, `binary=${binaryAllows ? "allow" : "deny"} profiles=${profileAllows ? "allow" : "deny"}`);
            }
          } else if (STATS_METHODS.has(method) && role !== "admin") {
            const scopes = [...policy.perWorkspace.values()].map((ws) =>
              method === "getCoaching" ? ws.coaching : ws.stats
            );
            const unrestricted = scopes.some((s) => s.visibleUserIds === null);
            const visibleCount = unrestricted
              ? Infinity
              : new Set(scopes.flatMap((s) => [...(s.visibleUserIds ?? [])])).size;
            if (unrestricted || visibleCount > 1) {
              diff(method, `binary=self-only profiles=${unrestricted ? "unrestricted" : `${visibleCount} visible users`}`);
            }
          } else if (CALL_METHODS.has(method) && role !== "admin") {
            const callScopes = [...policy.perWorkspace.values()].map((ws) => ws.calls);
            const unrestricted = callScopes.some((s) => s.visibleUserIds === null);
            const visibleCount = unrestricted
              ? Infinity
              : new Set(callScopes.flatMap((s) => [...(s.visibleUserIds ?? [])])).size;
            if (unrestricted || visibleCount > 1) {
              diff(method, `binary=participant-only profiles=${unrestricted ? "unrestricted" : `${visibleCount} visible users`}`);
            }
          }
        } catch (err) {
          console.error(`[policy] SHADOW evaluator error on ${method}: ${err instanceof Error ? err.message : err}`);
        }
        return original.apply(target, args);
      };
    },
  }) as GongClient;
}
