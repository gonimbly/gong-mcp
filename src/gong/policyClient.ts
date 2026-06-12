/**
 * Phase 3: per-user policy enforcement driven by Gong permission profiles.
 *
 * Replaces the binary admin/member checks of ScopedGongClient with a UserPolicy
 * resolved from the user's actual Gong permission profile (permissionResolver.ts):
 *
 *  - calls/transcripts   visibility-filtered: a call is visible when any party is in
 *                        the user's visible set for that call's workspace
 *  - stats/coaching      scoped: requested userIds are intersected with the visible set
 *  - deals/CRM reads     gated on dealsAccess; CRM writes on the crmWrite capability
 *  - AI synthesis        requires callsAccess "all" in the target workspace — these
 *                        tools draw on every call there, anything less would leak
 *  - library             gated on libraryFolderAccess (folder allowlist when set)
 *  - admin surface       gated on manageGeneralBusinessSettings (techAdmin)
 *
 * Break-glass admins (GONG_ADMIN_EMAILS) never reach this class — the server gives
 * them the org-wide passthrough client directly.
 *
 * Multi-workspace users hold one policy per workspace. Workspace-scoped queries use
 * that workspace's policy; unscoped call queries filter each call by its own
 * workspace; unscoped stats queries fail closed to the intersection when the
 * per-workspace policies disagree.
 */
import { GongClient } from "./client.js";
import { AccessDeniedError } from "./scopedClient.js";
import type { GongIdentity } from "./identity.js";
import type { DomainAccess, UserPolicy, WorkspacePolicy } from "./permissionResolver.js";

const LOOKBACK_DAYS = 90;

type StatsDomain = "calls" | "deals" | "coaching" | "stats";

interface ExtensiveParty {
  userId?: string;
  emailAddress?: string;
}

interface ExtensiveCall {
  metaData?: { id?: string; workspaceId?: string };
  parties?: ExtensiveParty[];
}

interface ExtensiveCallsResponse {
  calls?: ExtensiveCall[];
  records?: Record<string, unknown>;
}

export class PolicyGongClient extends GongClient {
  constructor(
    private readonly identity: GongIdentity,
    private readonly policy: UserPolicy
  ) {
    super();
  }

  // ── Policy lookups ──────────────────────────────────────────────────────────

  private wsPolicy(workspaceId: string): WorkspacePolicy | undefined {
    return this.policy.perWorkspace.get(workspaceId) ?? this.policy.perWorkspace.get("*");
  }

  /**
   * Effective access for a domain. With a workspaceId, that workspace's policy
   * (no profile there → own data only). Without one, the per-workspace policies
   * merged fail-closed: identical sets pass through, disagreements intersect.
   */
  private access(domain: StatsDomain, workspaceId?: string): DomainAccess {
    if (workspaceId) {
      const ws = this.wsPolicy(workspaceId);
      if (!ws) return { level: "none", visibleUserIds: new Set([this.identity.userId]) };
      return ws[domain];
    }
    const accesses = [...this.policy.perWorkspace.values()].map((ws) => ws[domain]);
    if (accesses.every((a) => a.visibleUserIds === null)) {
      return { level: "all", visibleUserIds: null };
    }
    const constraints = accesses
      .map((a) => a.visibleUserIds)
      .filter((s): s is Set<string> => s !== null); // "all" imposes no constraint
    let visible = new Set(constraints[0] ?? []);
    for (const constraint of constraints.slice(1)) {
      visible = new Set([...visible].filter((id) => constraint.has(id)));
    }
    visible.add(this.identity.userId);
    return { level: "report-to-them", visibleUserIds: visible };
  }

  private deny(what: string, hint?: string): never {
    const profiles = [...this.policy.perWorkspace.values()].map((w) => w.profileName).join(", ");
    console.error(`[policy] DENY ${what} for ${this.identity.email} (profile: ${profiles})`);
    throw new AccessDeniedError(
      `Access denied: ${what} is not granted by your Gong permission profile (${profiles}).` +
      (hint ? ` ${hint}` : "") +
      ` Contact your Gong administrator if you need this.`
    );
  }

  private requireCapability(flag: keyof UserPolicy["capabilities"], what: string): void {
    if (!this.policy.capabilities[flag]) this.deny(what);
  }

  // ── Calls: visibility-filtered by the policy's visible-user set ────────────

  private isVisibleCall(call: ExtensiveCall): boolean {
    const access = this.access("calls", call.metaData?.workspaceId);
    const visible = access.visibleUserIds;
    if (visible === null) return true;
    return (call.parties ?? []).some(
      (p) =>
        (p.userId && visible.has(String(p.userId))) ||
        (p.emailAddress && p.emailAddress.toLowerCase() === this.identity.email)
    );
  }

  private callsUnrestricted(workspaceId?: string): boolean {
    return this.access("calls", workspaceId).visibleUserIds === null;
  }

  private defaultRange(from?: string, to?: string): { fromDateTime: string; toDateTime: string } {
    return {
      fromDateTime: from ?? new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      toDateTime: to ?? new Date().toISOString(),
    };
  }

  private async visibleCallIds(callIds: string[]): Promise<Set<string>> {
    if (callIds.length === 0) return new Set();
    const data = await super.getExtensiveCalls({
      filter: { callIds },
      contentSelector: { exposedFields: { parties: true } },
    }) as ExtensiveCallsResponse;
    const allowed = new Set<string>();
    for (const call of data.calls ?? []) {
      const id = call.metaData?.id;
      if (id && this.isVisibleCall(call)) allowed.add(String(id));
    }
    return allowed;
  }

  override async listCalls(params?: { cursor?: string; fromDateTime?: string; toDateTime?: string; workspaceId?: string }) {
    if (this.callsUnrestricted(params?.workspaceId)) return super.listCalls(params);
    const range = this.defaultRange(params?.fromDateTime, params?.toDateTime);
    const data = await super.getExtensiveCalls({
      filter: { ...range, ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}) },
      contentSelector: { exposedFields: { parties: true } },
      ...(params?.cursor ? { cursor: params.cursor } : {}),
    }) as ExtensiveCallsResponse;
    return {
      calls: (data.calls ?? []).filter((c) => this.isVisibleCall(c)),
      records: data.records,
      note: "Results are limited to calls visible to your Gong permission profile. Pages may contain fewer items than the page size; keep paginating with the cursor.",
    };
  }

  override async getCall(callId: string) {
    if (this.callsUnrestricted()) return super.getCall(callId);
    const allowed = await this.visibleCallIds([callId]);
    if (!allowed.has(String(callId))) {
      this.deny(`call ${callId}`, "The call is outside your profile's visibility.");
    }
    return super.getCall(callId);
  }

  override async getExtensiveCalls(body: {
    filter?: Record<string, unknown>;
    contentSelector?: Record<string, unknown>;
    cursor?: string;
  }) {
    const workspaceId = body.filter?.workspaceId as string | undefined;
    if (this.callsUnrestricted(workspaceId)) return super.getExtensiveCalls(body);
    const contentSelector = {
      ...(body.contentSelector ?? {}),
      exposedFields: {
        ...((body.contentSelector as { exposedFields?: Record<string, unknown> } | undefined)?.exposedFields ?? {}),
        parties: true, // required for the visibility check
      },
    };
    const data = await super.getExtensiveCalls({ ...body, contentSelector }) as ExtensiveCallsResponse;
    return {
      ...data,
      calls: (data.calls ?? []).filter((c) => this.isVisibleCall(c)),
      note: "Results are limited to calls visible to your Gong permission profile.",
    };
  }

  override async getCallTranscripts(callIds: string[]) {
    if (this.callsUnrestricted()) return super.getCallTranscripts(callIds);
    const allowed = await this.visibleCallIds(callIds);
    const denied = callIds.filter((id) => !allowed.has(String(id)));
    if (denied.length > 0) {
      this.deny(`transcripts for call(s) ${denied.join(", ")}`, "They are outside your profile's visibility.");
    }
    return super.getCallTranscripts(callIds);
  }

  override createCall(body: unknown) {
    this.requireCapability("scheduleCalls", "creating calls");
    return super.createCall(body);
  }

  override uploadCallMedia(callId: string, mediaUrl: string) {
    this.requireCapability("scheduleCalls", "uploading call media");
    return super.uploadCallMedia(callId, mediaUrl);
  }

  // ── Stats & coaching: requested userIds ∩ visible set ─────────────────────

  private scopeStats<T extends { filter: Record<string, unknown> }>(body: T, domain: StatsDomain = "stats"): T {
    const access = this.access(domain, body.filter.workspaceId as string | undefined);
    if (access.visibleUserIds === null) return body;
    const visible = access.visibleUserIds;
    const requested = body.filter.userIds as string[] | undefined;
    const scoped = requested
      ? requested.filter((id) => visible.has(String(id)))
      : [...visible];
    if (scoped.length === 0) {
      this.deny(
        "stats for the requested users",
        "None of them are within your profile's visibility. Omit userIds to query everyone you can see."
      );
    }
    return { ...body, filter: { ...body.filter, userIds: scoped } };
  }

  override getActivityAggregate(body: { filter: Record<string, unknown> }) {
    return super.getActivityAggregate(this.scopeStats(body));
  }

  override getActivityAggregateByPeriod(body: { filter: Record<string, unknown>; aggregationPeriod?: string }) {
    return super.getActivityAggregateByPeriod(this.scopeStats(body));
  }

  override getActivityDayByDay(body: { filter: Record<string, unknown> }) {
    return super.getActivityDayByDay(this.scopeStats(body));
  }

  override getScorecardStats(body: { filter: Record<string, unknown> }) {
    return super.getScorecardStats(this.scopeStats(body));
  }

  override getInteractionStats(body: { filter: Record<string, unknown> }) {
    return super.getInteractionStats(this.scopeStats(body));
  }

  override getCoaching(params: Parameters<GongClient["getCoaching"]>[0]) {
    const access = this.access("coaching", params.workspaceId);
    if (access.visibleUserIds === null) return super.getCoaching(params);
    // Coaching is manager-centric: the target manager must be within the
    // profile's coaching visibility.
    const target = params.managerId ?? this.identity.userId;
    if (!access.visibleUserIds.has(String(target))) {
      this.deny(`coaching data for manager ${target}`, "They are outside your profile's visibility.");
    }
    return super.getCoaching({ ...params, managerId: target });
  }

  // ── AI synthesis: requires org-wide call access in the target workspace ────

  private requireAllCalls(workspaceId: string, what: string): void {
    if (this.access("calls", workspaceId).visibleUserIds !== null) {
      this.deny(what, "It synthesizes from every call in the workspace, which requires unrestricted call access.");
    }
  }

  override askAccount(params: Parameters<GongClient["askAccount"]>[0]) {
    this.requireAllCalls(params.workspaceId, "AI account Q&A");
    return super.askAccount(params);
  }

  override askDeal(params: Parameters<GongClient["askDeal"]>[0]) {
    this.requireAllCalls(params.workspaceId, "AI deal Q&A");
    return super.askDeal(params);
  }

  override generateBrief(params: Parameters<GongClient["generateBrief"]>[0]) {
    this.requireAllCalls(params.workspaceId, "AI brief generation");
    return super.generateBrief(params);
  }

  // ── Library: gated on libraryFolderAccess ──────────────────────────────────

  private libraryLevels(): Array<WorkspacePolicy["library"]> {
    return [...this.policy.perWorkspace.values()].map((ws) => ws.library);
  }

  override listLibraryFolders(workspaceId?: string) {
    if (this.libraryLevels().every((l) => l.level === "none")) this.deny("the call library");
    return super.listLibraryFolders(workspaceId);
  }

  override getLibraryFolderContent(folderId: string, cursor?: string) {
    const levels = this.libraryLevels();
    if (levels.every((l) => l.level === "none")) this.deny("the call library");
    const unrestricted = levels.some((l) => l.level === "all");
    if (!unrestricted) {
      const allowed = levels.some((l) => l.folderIds?.has(String(folderId)));
      if (!allowed) this.deny(`library folder ${folderId}`, "It is outside your profile's folder access.");
    }
    return super.getLibraryFolderContent(folderId, cursor);
  }

  // ── CRM & deals: reads gated on dealsAccess, writes on capabilities ───────

  private requireDealsRead(what: string): void {
    const open = [...this.policy.perWorkspace.values()].some((ws) => ws.deals.level !== "none");
    if (!open) this.deny(what);
  }

  override getCrmEntities(params: Parameters<GongClient["getCrmEntities"]>[0]) {
    this.requireDealsRead("CRM data");
    return super.getCrmEntities(params);
  }

  override getCrmEntitySchema(params: Parameters<GongClient["getCrmEntitySchema"]>[0]) {
    this.requireDealsRead("CRM data");
    return super.getCrmEntitySchema(params);
  }

  override getCrmRequestStatus(params: Parameters<GongClient["getCrmRequestStatus"]>[0]) {
    this.requireDealsRead("CRM data");
    return super.getCrmRequestStatus(params);
  }

  override upsertCrmEntities(body: unknown) {
    this.requireCapability("crmWrite", "CRM writes");
    return super.upsertCrmEntities(body);
  }

  override setCrmEntitySchema(body: unknown) {
    this.requireCapability("crmWrite", "CRM schema changes");
    return super.setCrmEntitySchema(body);
  }

  override getCrmIntegrations() {
    this.requireCapability("techAdmin", "CRM integration management");
    return super.getCrmIntegrations();
  }

  override updateCrmIntegration(body: unknown) {
    this.requireCapability("techAdmin", "CRM integration management");
    return super.updateCrmIntegration(body);
  }

  override deleteCrmIntegration() {
    this.requireCapability("techAdmin", "CRM integration management");
    return super.deleteCrmIntegration();
  }

  // ── Meetings ────────────────────────────────────────────────────────────────

  override createMeeting(body: unknown) {
    this.requireCapability("scheduleCalls", "creating meetings");
    return super.createMeeting(body);
  }

  override updateMeeting(meetingId: string, body: unknown) {
    this.requireCapability("scheduleCalls", "updating meetings");
    return super.updateMeeting(meetingId, body);
  }

  override deleteMeeting(meetingId: string) {
    this.requireCapability("scheduleCalls", "deleting meetings");
    return super.deleteMeeting(meetingId);
  }

  override getMeetingIntegrationStatus(body: unknown) {
    this.requireCapability("techAdmin", "meeting integration status");
    return super.getMeetingIntegrationStatus(body);
  }

  // ── Users: directory open, deeper inspection is org admin surface ─────────

  override getUserSettingsHistory(userId: string) {
    this.requireCapability("techAdmin", "user settings history");
    return super.getUserSettingsHistory(userId);
  }

  override getExtensiveUsers(body: { filter?: Record<string, unknown>; cursor?: string }) {
    this.requireCapability("techAdmin", "extensive user data");
    return super.getExtensiveUsers(body);
  }

  // ── Org admin surface: permissions, privacy, logs, integrations ────────────

  override listAllPermissionProfiles(workspaceId?: string) {
    this.requireCapability("techAdmin", "permission profiles");
    return super.listAllPermissionProfiles(workspaceId);
  }

  override getPermissionProfile(profileId: string) {
    this.requireCapability("techAdmin", "permission profiles");
    return super.getPermissionProfile(profileId);
  }

  override createPermissionProfile(body: unknown) {
    this.requireCapability("techAdmin", "permission profiles");
    return super.createPermissionProfile(body);
  }

  override updatePermissionProfile(body: unknown) {
    this.requireCapability("techAdmin", "permission profiles");
    return super.updatePermissionProfile(body);
  }

  override getPermissionProfileUsers(profileId: string) {
    this.requireCapability("techAdmin", "permission profiles");
    return super.getPermissionProfileUsers(profileId);
  }

  override addCallUsersAccess(body: unknown) {
    this.requireCapability("techAdmin", "call access management");
    return super.addCallUsersAccess(body);
  }

  override updateCallUsersAccess(body: unknown) {
    this.requireCapability("techAdmin", "call access management");
    return super.updateCallUsersAccess(body);
  }

  override deleteCallUsersAccess(body: unknown) {
    this.requireCapability("techAdmin", "call access management");
    return super.deleteCallUsersAccess(body);
  }

  override getDataForEmail(emailAddress: string) {
    this.requireCapability("techAdmin", "data privacy lookups");
    return super.getDataForEmail(emailAddress);
  }

  override getDataForPhone(phoneNumber: string) {
    this.requireCapability("techAdmin", "data privacy lookups");
    return super.getDataForPhone(phoneNumber);
  }

  override eraseDataForEmail(emailAddress: string) {
    this.requireCapability("techAdmin", "data erasure");
    return super.eraseDataForEmail(emailAddress);
  }

  override eraseDataForPhone(phoneNumber: string) {
    this.requireCapability("techAdmin", "data erasure");
    return super.eraseDataForPhone(phoneNumber);
  }

  override getLogs(params: Parameters<GongClient["getLogs"]>[0]) {
    this.requireCapability("techAdmin", "audit logs");
    return super.getLogs(params);
  }

  override updateIntegrationSettings(body: unknown) {
    this.requireCapability("techAdmin", "integration settings");
    return super.updateIntegrationSettings(body);
  }

  // ── Flow / engagement / task writes: no profile field maps to these tools, ──
  //    so they stay on the org admin surface (same posture as Phase 2).

  override addProspectsToFlow(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.addProspectsToFlow(body);
  }

  override assignFlowToProspect(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.assignFlowToProspect(body);
  }

  override assignFlowCoolOffOverride(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.assignFlowCoolOffOverride(body);
  }

  override bulkAssignFlows(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.bulkAssignFlows(body);
  }

  override unassignFlowsByCrmId(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.unassignFlowsByCrmId(body);
  }

  override unassignFlowsByInstanceId(body: unknown) {
    this.requireCapability("techAdmin", "flow writes");
    return super.unassignFlowsByInstanceId(body);
  }

  override logDigitalInteraction(body: unknown) {
    this.requireCapability("techAdmin", "digital interaction writes");
    return super.logDigitalInteraction(body);
  }

  override recordCustomerEngagementAction(body: unknown) {
    this.requireCapability("techAdmin", "engagement writes");
    return super.recordCustomerEngagementAction(body);
  }

  override recordContentShared(body: unknown) {
    this.requireCapability("techAdmin", "engagement writes");
    return super.recordContentShared(body);
  }

  override recordContentViewed(body: unknown) {
    this.requireCapability("techAdmin", "engagement writes");
    return super.recordContentViewed(body);
  }

  override createTask(body: unknown) {
    this.requireCapability("techAdmin", "task writes");
    return super.createTask(body);
  }

  override updateTask(taskId: string, body: unknown) {
    this.requireCapability("techAdmin", "task writes");
    return super.updateTask(taskId, body);
  }
}
