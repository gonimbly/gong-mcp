/**
 * Per-user policy enforcement over the Gong API (Phase 2).
 *
 * Gong's REST API has no user-level access control — any credential is org-wide.
 * This client subclasses GongClient and applies a policy per method, bound to the
 * gateway user's Gong identity and role:
 *
 *  - participant-checked  calls/transcripts: members only see calls they took part in
 *  - self-scoped          stats/coaching: the caller's Gong userId is forced into filters
 *  - admin-only           writes, AI synthesis, privacy, logs, permissions, integrations
 *  - open                 harmless metadata (workspaces, trackers, directory, library)
 *
 * Tool registrations are unchanged — they receive this client and never know about roles.
 */
import { GongClient } from "./client.js";
import type { GongIdentity } from "./identity.js";

export type GatewayRole = "admin" | "member";

const PARTICIPANT_LOOKBACK_DAYS = 90;

interface ExtensiveParty {
  userId?: string;
  emailAddress?: string;
}

interface ExtensiveCall {
  metaData?: { id?: string };
  parties?: ExtensiveParty[];
}

interface ExtensiveCallsResponse {
  calls?: ExtensiveCall[];
  records?: Record<string, unknown>;
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class ScopedGongClient extends GongClient {
  constructor(
    private readonly identity: GongIdentity,
    private readonly role: GatewayRole
  ) {
    super();
  }

  private get isAdmin(): boolean {
    return this.role === "admin";
  }

  private requireAdmin(what: string): void {
    if (!this.isAdmin) {
      console.error(`[policy] DENY admin-only "${what}" for ${this.identity.email}`);
      throw new AccessDeniedError(
        `Access denied: ${what} requires Gong MCP admin access. ` +
        `You are connected as ${this.identity.email} (member). Contact your administrator if you need this.`
      );
    }
  }

  private isParty(call: ExtensiveCall): boolean {
    return (call.parties ?? []).some(
      (p) =>
        (p.userId && String(p.userId) === this.identity.userId) ||
        (p.emailAddress && p.emailAddress.toLowerCase() === this.identity.email)
    );
  }

  /** Force the caller's own Gong userId into a stats-style filter, overriding any input. */
  private selfScope<T extends { filter: Record<string, unknown> }>(body: T): T {
    return { ...body, filter: { ...body.filter, userIds: [this.identity.userId] } };
  }

  private defaultRange(from?: string, to?: string): { fromDateTime: string; toDateTime: string } {
    return {
      fromDateTime: from ?? new Date(Date.now() - PARTICIPANT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      toDateTime: to ?? new Date().toISOString(),
    };
  }

  /** Which of these call IDs is the user a participant of? */
  private async participatingCallIds(callIds: string[]): Promise<Set<string>> {
    if (callIds.length === 0) return new Set();
    const data = await super.getExtensiveCalls({
      filter: { callIds },
      contentSelector: { exposedFields: { parties: true } },
    }) as ExtensiveCallsResponse;
    const allowed = new Set<string>();
    for (const call of data.calls ?? []) {
      const id = call.metaData?.id;
      if (id && this.isParty(call)) allowed.add(String(id));
    }
    return allowed;
  }

  // ── Calls: participant-checked ─────────────────────────────────────────────

  override async listCalls(params?: { cursor?: string; fromDateTime?: string; toDateTime?: string; workspaceId?: string }) {
    if (this.isAdmin) return super.listCalls(params);
    const range = this.defaultRange(params?.fromDateTime, params?.toDateTime);
    const data = await super.getExtensiveCalls({
      filter: { ...range, ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}) },
      contentSelector: { exposedFields: { parties: true } },
      ...(params?.cursor ? { cursor: params.cursor } : {}),
    }) as ExtensiveCallsResponse;
    const calls = (data.calls ?? []).filter((c) => this.isParty(c));
    return {
      calls,
      records: data.records,
      note: "Results are limited to calls you participated in. Pages may contain fewer items than the page size; keep paginating with the cursor.",
    };
  }

  override async getCall(callId: string) {
    if (this.isAdmin) return super.getCall(callId);
    const allowed = await this.participatingCallIds([callId]);
    if (!allowed.has(String(callId))) {
      console.error(`[policy] DENY getCall ${callId} for ${this.identity.email}`);
      throw new AccessDeniedError(`Access denied: you are not a participant of call ${callId}.`);
    }
    return super.getCall(callId);
  }

  override async getExtensiveCalls(body: {
    filter?: Record<string, unknown>;
    contentSelector?: Record<string, unknown>;
    cursor?: string;
  }) {
    if (this.isAdmin) return super.getExtensiveCalls(body);
    const contentSelector = {
      ...(body.contentSelector ?? {}),
      exposedFields: {
        ...((body.contentSelector as { exposedFields?: Record<string, unknown> } | undefined)?.exposedFields ?? {}),
        parties: true, // required for the participation check
      },
    };
    const data = await super.getExtensiveCalls({ ...body, contentSelector }) as ExtensiveCallsResponse;
    return {
      ...data,
      calls: (data.calls ?? []).filter((c) => this.isParty(c)),
      note: "Results are limited to calls you participated in.",
    };
  }

  override async getCallTranscripts(callIds: string[]) {
    if (this.isAdmin) return super.getCallTranscripts(callIds);
    const allowed = await this.participatingCallIds(callIds);
    const denied = callIds.filter((id) => !allowed.has(String(id)));
    if (denied.length > 0) {
      console.error(`[policy] DENY transcripts ${denied.join(",")} for ${this.identity.email}`);
      throw new AccessDeniedError(
        `Access denied: you are not a participant of call(s) ${denied.join(", ")}. ` +
        `Transcripts are only available for calls you took part in.`
      );
    }
    return super.getCallTranscripts(callIds);
  }

  override createCall(body: unknown) {
    this.requireAdmin("creating calls");
    return super.createCall(body);
  }

  override uploadCallMedia(callId: string, mediaUrl: string) {
    this.requireAdmin("uploading call media");
    return super.uploadCallMedia(callId, mediaUrl);
  }

  // ── Stats & coaching: self-scoped ──────────────────────────────────────────

  override getActivityAggregate(body: { filter: Record<string, unknown> }) {
    return super.getActivityAggregate(this.isAdmin ? body : this.selfScope(body));
  }

  override getActivityAggregateByPeriod(body: { filter: Record<string, unknown> }) {
    return super.getActivityAggregateByPeriod(this.isAdmin ? body : this.selfScope(body));
  }

  override getActivityDayByDay(body: { filter: Record<string, unknown> }) {
    return super.getActivityDayByDay(this.isAdmin ? body : this.selfScope(body));
  }

  override getScorecardStats(body: { filter: Record<string, unknown> }) {
    return super.getScorecardStats(this.isAdmin ? body : this.selfScope(body));
  }

  override getInteractionStats(body: { filter: Record<string, unknown> }) {
    return super.getInteractionStats(this.isAdmin ? body : this.selfScope(body));
  }

  override getCoaching(params?: { workspaceId?: string; fromDateTime?: string; toDateTime?: string; userId?: string }) {
    return super.getCoaching(this.isAdmin ? params : { ...params, userId: this.identity.userId });
  }

  // ── AI synthesis: admin-only (may draw on calls the member cannot see) ─────

  override askAccount(params: Parameters<GongClient["askAccount"]>[0]) {
    this.requireAdmin("AI account Q&A (it synthesizes from calls you may not have access to)");
    return super.askAccount(params);
  }

  override askDeal(params: Parameters<GongClient["askDeal"]>[0]) {
    this.requireAdmin("AI deal Q&A (it synthesizes from calls you may not have access to)");
    return super.askDeal(params);
  }

  override generateBrief(params: Parameters<GongClient["generateBrief"]>[0]) {
    this.requireAdmin("AI brief generation (it synthesizes from calls you may not have access to)");
    return super.generateBrief(params);
  }

  // ── Users: directory open, deeper inspection admin-only ───────────────────

  override getUserSettingsHistory(userId: string) {
    this.requireAdmin("user settings history");
    return super.getUserSettingsHistory(userId);
  }

  override getExtensiveUsers(body: { filter?: Record<string, unknown>; cursor?: string }) {
    this.requireAdmin("extensive user data");
    return super.getExtensiveUsers(body);
  }

  // ── CRM: reads open, writes and integration management admin-only ─────────

  override upsertCrmEntities(body: unknown) {
    this.requireAdmin("CRM writes");
    return super.upsertCrmEntities(body);
  }

  override setCrmEntitySchema(body: unknown) {
    this.requireAdmin("CRM schema changes");
    return super.setCrmEntitySchema(body);
  }

  override getCrmIntegrations() {
    this.requireAdmin("CRM integration management");
    return super.getCrmIntegrations();
  }

  override updateCrmIntegration(body: unknown) {
    this.requireAdmin("CRM integration management");
    return super.updateCrmIntegration(body);
  }

  override deleteCrmIntegration() {
    this.requireAdmin("CRM integration management");
    return super.deleteCrmIntegration();
  }

  // ── Meetings: admin-only (org credential cannot bind the organizer) ───────

  override createMeeting(body: unknown) {
    this.requireAdmin("creating meetings");
    return super.createMeeting(body);
  }

  override updateMeeting(meetingId: string, body: unknown) {
    this.requireAdmin("updating meetings");
    return super.updateMeeting(meetingId, body);
  }

  override deleteMeeting(meetingId: string) {
    this.requireAdmin("deleting meetings");
    return super.deleteMeeting(meetingId);
  }

  override getMeetingIntegrationStatus(body: unknown) {
    this.requireAdmin("meeting integration status");
    return super.getMeetingIntegrationStatus(body);
  }

  // ── Permissions: admin-only ────────────────────────────────────────────────

  override listAllPermissionProfiles(workspaceId?: string) {
    this.requireAdmin("permission profiles");
    return super.listAllPermissionProfiles(workspaceId);
  }

  override getPermissionProfile(profileId: string) {
    this.requireAdmin("permission profiles");
    return super.getPermissionProfile(profileId);
  }

  override createPermissionProfile(body: unknown) {
    this.requireAdmin("permission profiles");
    return super.createPermissionProfile(body);
  }

  override updatePermissionProfile(body: unknown) {
    this.requireAdmin("permission profiles");
    return super.updatePermissionProfile(body);
  }

  override getPermissionProfileUsers(profileId: string) {
    this.requireAdmin("permission profiles");
    return super.getPermissionProfileUsers(profileId);
  }

  override addCallUsersAccess(body: unknown) {
    this.requireAdmin("call access management");
    return super.addCallUsersAccess(body);
  }

  override updateCallUsersAccess(body: unknown) {
    this.requireAdmin("call access management");
    return super.updateCallUsersAccess(body);
  }

  override deleteCallUsersAccess(body: unknown) {
    this.requireAdmin("call access management");
    return super.deleteCallUsersAccess(body);
  }

  // ── Flows: reads open, writes admin-only ───────────────────────────────────

  override addProspectsToFlow(body: unknown) {
    this.requireAdmin("flow writes");
    return super.addProspectsToFlow(body);
  }

  override assignFlowToProspect(body: unknown) {
    this.requireAdmin("flow writes");
    return super.assignFlowToProspect(body);
  }

  override assignFlowCoolOffOverride(body: unknown) {
    this.requireAdmin("flow writes");
    return super.assignFlowCoolOffOverride(body);
  }

  override bulkAssignFlows(body: unknown) {
    this.requireAdmin("flow writes");
    return super.bulkAssignFlows(body);
  }

  override unassignFlowsByCrmId(body: unknown) {
    this.requireAdmin("flow writes");
    return super.unassignFlowsByCrmId(body);
  }

  override unassignFlowsByInstanceId(body: unknown) {
    this.requireAdmin("flow writes");
    return super.unassignFlowsByInstanceId(body);
  }

  // ── Engagement / integration / tasks writes: admin-only ───────────────────

  override logDigitalInteraction(body: unknown) {
    this.requireAdmin("digital interaction writes");
    return super.logDigitalInteraction(body);
  }

  override updateIntegrationSettings(body: unknown) {
    this.requireAdmin("integration settings");
    return super.updateIntegrationSettings(body);
  }

  override recordCustomerEngagementAction(body: unknown) {
    this.requireAdmin("engagement writes");
    return super.recordCustomerEngagementAction(body);
  }

  override recordContentShared(body: unknown) {
    this.requireAdmin("engagement writes");
    return super.recordContentShared(body);
  }

  override recordContentViewed(body: unknown) {
    this.requireAdmin("engagement writes");
    return super.recordContentViewed(body);
  }

  override createTask(body: unknown) {
    this.requireAdmin("task writes");
    return super.createTask(body);
  }

  override updateTask(taskId: string, body: unknown) {
    this.requireAdmin("task writes");
    return super.updateTask(taskId, body);
  }

  // ── Data privacy & logs: admin-only ────────────────────────────────────────

  override getDataForEmail(emailAddress: string) {
    this.requireAdmin("data privacy lookups");
    return super.getDataForEmail(emailAddress);
  }

  override getDataForPhone(phoneNumber: string) {
    this.requireAdmin("data privacy lookups");
    return super.getDataForPhone(phoneNumber);
  }

  override eraseDataForEmail(emailAddress: string) {
    this.requireAdmin("data erasure");
    return super.eraseDataForEmail(emailAddress);
  }

  override eraseDataForPhone(phoneNumber: string) {
    this.requireAdmin("data erasure");
    return super.eraseDataForPhone(phoneNumber);
  }

  override getLogs(params?: { fromDateTime?: string; toDateTime?: string; cursor?: string }) {
    this.requireAdmin("audit logs");
    return super.getLogs(params);
  }
}
