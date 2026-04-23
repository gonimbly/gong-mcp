export interface GongConfig {
  accessKey: string;
  accessKeySecret: string;
  baseUrl?: string;
}

export class GongClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: GongConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.gong.io";
    const credentials = Buffer.from(
      `${config.accessKey}:${config.accessKeySecret}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gong API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private qs(params: Record<string, string | string[] | boolean | undefined>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => p.append(k, item));
      else p.set(k, String(v));
    }
    const str = p.toString();
    return str ? `?${str}` : "";
  }

  // ── Calls ────────────────────────────────────────────────────────────────

  listCalls(params?: { cursor?: string; fromDateTime?: string; toDateTime?: string; workspaceId?: string }) {
    return this.request(`/v2/calls${this.qs(params ?? {})}`);
  }

  createCall(body: unknown) {
    return this.request("/v2/calls", { method: "POST", body: JSON.stringify(body) });
  }

  getCall(callId: string) {
    return this.request(`/v2/calls/${callId}`);
  }

  uploadCallMedia(callId: string, mediaUrl: string) {
    return this.request(`/v2/calls/${callId}/media`, {
      method: "PUT",
      body: JSON.stringify({ mediaUrl }),
    });
  }

  getExtensiveCalls(body: {
    filter?: Record<string, unknown>;
    contentSelector?: Record<string, unknown>;
    cursor?: string;
  }) {
    return this.request("/v2/calls/extensive", { method: "POST", body: JSON.stringify(body) });
  }

  getCallTranscripts(callIds: string[]) {
    return this.request("/v2/calls/transcript", {
      method: "POST",
      body: JSON.stringify({ filter: { callIds } }),
    });
  }

  // ── Users ────────────────────────────────────────────────────────────────

  listUsers(params?: { cursor?: string; includeAvatars?: boolean }) {
    return this.request(`/v2/users${this.qs(params ?? {})}`);
  }

  getUser(userId: string) {
    return this.request(`/v2/users/${userId}`);
  }

  getUserSettingsHistory(userId: string) {
    return this.request(`/v2/users/${userId}/settings-history`);
  }

  getExtensiveUsers(body: { filter?: Record<string, unknown>; cursor?: string }) {
    return this.request("/v2/users/extensive", { method: "POST", body: JSON.stringify(body) });
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  getActivityAggregate(body: { filter: Record<string, unknown> }) {
    return this.request("/v2/stats/activity/aggregate", { method: "POST", body: JSON.stringify(body) });
  }

  getActivityAggregateByPeriod(body: { filter: Record<string, unknown> }) {
    return this.request("/v2/stats/activity/aggregate-by-period", { method: "POST", body: JSON.stringify(body) });
  }

  getActivityDayByDay(body: { filter: Record<string, unknown> }) {
    return this.request("/v2/stats/activity/day-by-day", { method: "POST", body: JSON.stringify(body) });
  }

  getScorecardStats(body: { filter: Record<string, unknown> }) {
    return this.request("/v2/stats/activity/scorecards", { method: "POST", body: JSON.stringify(body) });
  }

  getInteractionStats(body: { filter: Record<string, unknown> }) {
    return this.request("/v2/stats/interaction", { method: "POST", body: JSON.stringify(body) });
  }

  // ── Entities (AI) ────────────────────────────────────────────────────────

  askAccount(params: {
    workspaceId: string;
    crmAccountId: string;
    fromDateTime: string;
    toDateTime: string;
    question: string;
  }) {
    return this.request(
      `/v2/entities/ask-entity${this.qs({
        workspaceId: params.workspaceId,
        entityType: "Account",
        crmEntityId: params.crmAccountId,
        fromDateTime: params.fromDateTime,
        toDateTime: params.toDateTime,
        question: params.question,
      })}`
    );
  }

  askDeal(params: {
    workspaceId: string;
    crmDealId: string;
    fromDateTime: string;
    toDateTime: string;
    question: string;
  }) {
    return this.request(
      `/v2/entities/ask-entity${this.qs({
        workspaceId: params.workspaceId,
        entityType: "Opportunity",
        crmEntityId: params.crmDealId,
        fromDateTime: params.fromDateTime,
        toDateTime: params.toDateTime,
        question: params.question,
      })}`
    );
  }

  generateBrief(params: {
    workspaceId: string;
    briefName: string;
    entityType: "ACCOUNT" | "DEAL" | "CONTACT";
    crmEntityId: string;
    periodType: string;
    fromDateTime: string;
    toDateTime: string;
  }) {
    return this.request(`/v2/entities/get-brief${this.qs(params)}`);
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  listScorecards() {
    return this.request("/v2/settings/scorecards");
  }

  listTrackers() {
    return this.request("/v2/settings/trackers");
  }

  listWorkspaces() {
    return this.request("/v2/workspaces");
  }

  // ── Library ──────────────────────────────────────────────────────────────

  listLibraryFolders() {
    return this.request("/v2/library/folders");
  }

  getLibraryFolderContent(folderId: string, cursor?: string) {
    return this.request(`/v2/library/folder-content${this.qs({ folderId, cursor })}`);
  }

  // ── CRM ──────────────────────────────────────────────────────────────────

  getCrmEntities(params: { crmObjectType: string; fromDateTime?: string; cursor?: string }) {
    return this.request(`/v2/crm/entities${this.qs(params)}`);
  }

  upsertCrmEntities(body: unknown) {
    return this.request("/v2/crm/entities", { method: "POST", body: JSON.stringify(body) });
  }

  getCrmEntitySchema(crmObjectType: string) {
    return this.request(`/v2/crm/entity-schema${this.qs({ crmObjectType })}`);
  }

  setCrmEntitySchema(body: unknown) {
    return this.request("/v2/crm/entity-schema", { method: "POST", body: JSON.stringify(body) });
  }

  getCrmIntegrations() {
    return this.request("/v2/crm/integrations");
  }

  updateCrmIntegration(body: unknown) {
    return this.request("/v2/crm/integrations", { method: "PUT", body: JSON.stringify(body) });
  }

  deleteCrmIntegration() {
    return this.request("/v2/crm/integrations", { method: "DELETE" });
  }

  getCrmRequestStatus(requestId: string) {
    return this.request(`/v2/crm/request-status${this.qs({ requestId })}`);
  }

  // ── Logs ─────────────────────────────────────────────────────────────────

  getLogs(params?: { fromDateTime?: string; toDateTime?: string; cursor?: string }) {
    return this.request(`/v2/logs${this.qs(params ?? {})}`);
  }

  // ── Meetings ─────────────────────────────────────────────────────────────

  createMeeting(body: unknown) {
    return this.request("/v2/meetings", { method: "POST", body: JSON.stringify(body) });
  }

  updateMeeting(meetingId: string, body: unknown) {
    return this.request(`/v2/meetings/${meetingId}`, { method: "PUT", body: JSON.stringify(body) });
  }

  deleteMeeting(meetingId: string) {
    return this.request(`/v2/meetings/${meetingId}`, { method: "DELETE" });
  }

  getMeetingIntegrationStatus(body: unknown) {
    return this.request("/v2/meetings/integration/status", { method: "POST", body: JSON.stringify(body) });
  }

  // ── Permissions ──────────────────────────────────────────────────────────

  listAllPermissionProfiles(workspaceId?: string) {
    return this.request(`/v2/all-permission-profiles${this.qs({ workspaceId })}`);
  }

  getPermissionProfile(profileId: string) {
    return this.request(`/v2/permission-profile${this.qs({ profileId })}`);
  }

  createPermissionProfile(body: unknown) {
    return this.request("/v2/permission-profile", { method: "POST", body: JSON.stringify(body) });
  }

  updatePermissionProfile(body: unknown) {
    return this.request("/v2/permission-profile", { method: "PUT", body: JSON.stringify(body) });
  }

  getPermissionProfileUsers(profileId: string) {
    return this.request(`/v2/permission-profile/users${this.qs({ profileId })}`);
  }

  addCallUsersAccess(body: unknown) {
    return this.request("/v2/calls/users-access", { method: "POST", body: JSON.stringify(body) });
  }

  updateCallUsersAccess(body: unknown) {
    return this.request("/v2/calls/users-access", { method: "PUT", body: JSON.stringify(body) });
  }

  deleteCallUsersAccess(body: unknown) {
    return this.request("/v2/calls/users-access", { method: "DELETE", body: JSON.stringify(body) });
  }

  // ── Flows ────────────────────────────────────────────────────────────────

  listFlows(workspaceId?: string) {
    return this.request(`/v2/flows${this.qs({ workspaceId })}`);
  }

  listFlowFolders(workspaceId?: string) {
    return this.request(`/v2/flows/folders${this.qs({ workspaceId })}`);
  }

  addProspectsToFlow(body: unknown) {
    return this.request("/v2/flows/prospects", { method: "POST", body: JSON.stringify(body) });
  }

  assignFlowToProspect(body: unknown) {
    return this.request("/v2/flows/prospects/assign", { method: "POST", body: JSON.stringify(body) });
  }

  assignFlowCoolOffOverride(body: unknown) {
    return this.request("/v2/flows/prospects/assign/cool-off-override", { method: "POST", body: JSON.stringify(body) });
  }

  bulkAssignFlows(body: unknown) {
    return this.request("/v2/flows/prospects/bulk-assignments", { method: "POST", body: JSON.stringify(body) });
  }

  getBulkAssignmentStatus(id: string) {
    return this.request(`/v2/flows/prospects/bulk-assignments/${id}`);
  }

  unassignFlowsByCrmId(body: unknown) {
    return this.request("/v2/flows/prospects/unassign-flows-by-crm-id", { method: "POST", body: JSON.stringify(body) });
  }

  unassignFlowsByInstanceId(body: unknown) {
    return this.request("/v2/flows/prospects/unassign-flows-by-instance-id", { method: "POST", body: JSON.stringify(body) });
  }

  // ── Digital Interactions & Engagement ────────────────────────────────────

  logDigitalInteraction(body: unknown) {
    return this.request("/v2/digital-interaction", { method: "POST", body: JSON.stringify(body) });
  }

  updateIntegrationSettings(body: unknown) {
    return this.request("/v2/integration-settings", { method: "POST", body: JSON.stringify(body) });
  }

  recordCustomerEngagementAction(body: unknown) {
    return this.request("/v2/customer-engagement/action", { method: "PUT", body: JSON.stringify(body) });
  }

  recordContentShared(body: unknown) {
    return this.request("/v2/customer-engagement/content/shared", { method: "PUT", body: JSON.stringify(body) });
  }

  recordContentViewed(body: unknown) {
    return this.request("/v2/customer-engagement/content/viewed", { method: "PUT", body: JSON.stringify(body) });
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  createTask(body: unknown) {
    return this.request("/v2/tasks", { method: "POST", body: JSON.stringify(body) });
  }

  updateTask(taskId: string, body: unknown) {
    return this.request(`/v2/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  // ── Coaching & Outcomes ──────────────────────────────────────────────────

  getCoaching(params?: { fromDateTime?: string; toDateTime?: string; userId?: string }) {
    return this.request(`/v2/coaching${this.qs(params ?? {})}`);
  }

  listCallOutcomes() {
    return this.request("/v2/call-outcomes");
  }

  // ── Data Privacy ─────────────────────────────────────────────────────────

  getDataForEmail(emailAddress: string) {
    return this.request(`/v2/data-privacy/data-for-email-address${this.qs({ emailAddress })}`);
  }

  getDataForPhone(phoneNumber: string) {
    return this.request(`/v2/data-privacy/data-for-phone-number${this.qs({ phoneNumber })}`);
  }

  eraseDataForEmail(emailAddress: string) {
    return this.request("/v2/data-privacy/erase-data-for-email-address", {
      method: "POST",
      body: JSON.stringify({ emailAddress }),
    });
  }

  eraseDataForPhone(phoneNumber: string) {
    return this.request("/v2/data-privacy/erase-data-for-phone-number", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    });
  }
}
