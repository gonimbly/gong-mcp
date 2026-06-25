import { loadTokens, saveTokens, hasLegacyCredentials, type OAuthTokens } from "./tokenStore.js";
import { refreshAccessToken } from "./oauth.js";
import { quotaTracker } from "./quota.js";
import { sendSlackAlert } from "../utils/alert.js";
import { aiEntitiesEnabled } from "../utils/featureFlags.js";

let consecutiveErrors = 0;
let consecutiveAlertFired = false;
const CONSECUTIVE_ERROR_THRESHOLD = 5;

/** Gong endpoints that consume paid AI credits. Routing to either spends real
 * money on the org's Gong bill, so they are blocked unless GONG_ENABLE_AI_ENTITIES
 * is explicitly set — see aiEntitiesEnabled(). The block lives here, at the single
 * request chokepoint, so it holds for ANY caller: a stale skill version that still
 * has the tools cached, a manual probe, or future code — not just the tool layer. */
const CREDIT_ENDPOINTS = ["/v2/entities/ask-entity", "/v2/entities/get-brief"];

/** A non-2xx response from the Gong API, carrying the HTTP status for callers
 * that branch on it (e.g. Gong signals "no results" as a 404). */
export class GongApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GongApiError";
  }
}

export class GongClient {
  private readonly baseUrl: string;
  private refreshPromise: Promise<OAuthTokens> | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.GONG_BASE_URL ?? "https://api.gong.io";
  }

  /**
   * Server/gateway mode: an org-wide credential supplied via env, held only on the
   * server. Takes priority over the local per-user OAuth keychain flow.
   */
  private getOrgAuthHeader(): string | null {
    const key = process.env.GONG_ACCESS_KEY;
    const secret = process.env.GONG_ACCESS_KEY_SECRET;
    if (!key || !secret) return null;
    return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  }

  private async getAuthHeader(): Promise<string> {
    const orgHeader = this.getOrgAuthHeader();
    if (orgHeader) return orgHeader;
    return `Bearer ${await this.getAccessToken()}`;
  }

  private async getAccessToken(): Promise<string> {
    const tokens = await loadTokens();
    if (!tokens) {
      if (hasLegacyCredentials()) {
        throw new Error(
          "Your Gong account is using old API key authentication. Run gong_login to upgrade to OAuth."
        );
      }
      throw new Error("Not authenticated. Run gong_login to connect your Gong account.");
    }

    if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      // Deduplicate concurrent refresh calls — only one refresh flies at a time
      if (!this.refreshPromise) {
        this.refreshPromise = refreshAccessToken(tokens)
          .then(async (refreshed) => {
            await saveTokens(refreshed);
            return refreshed;
          })
          .finally(() => {
            this.refreshPromise = null;
          });
      }
      return (await this.refreshPromise).accessToken;
    }

    return tokens.accessToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!aiEntitiesEnabled() && CREDIT_ENDPOINTS.some((p) => path.startsWith(p))) {
      throw new Error(
        "Gong AI entity endpoints (ask-entity / get-brief) are disabled because they " +
        "consume paid Gong AI credits. Use the credit-free gong_entity_context tool instead, " +
        "or set GONG_ENABLE_AI_ENTITIES=true to re-enable the paid tools."
      );
    }
    if (quotaTracker.isOverLimit()) {
      const { limit } = quotaTracker.getStatus();
      throw new Error(
        `GONG API daily quota of ${limit} requests has been reached. ` +
        "Quota resets at midnight UTC — please try again tomorrow. " +
        "If your org has a higher negotiated Gong limit, set GONG_DAILY_QUOTA."
      );
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      // Never follow redirects: fetch strips the Authorization header on
      // cross-origin redirects, which surfaces as a confusing Gong 401.
      redirect: "manual",
      headers: {
        Authorization: await this.getAuthHeader(),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "unknown";
      throw new Error(
        `Gong API redirected ${url} to ${location}. ` +
        `Set GONG_BASE_URL to your org's API endpoint (shown in Gong → Settings → API).`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        sendSlackAlert(
          "⚠️ Gong API returned 429 (rate limited). " +
          "Our quota counter may be undercounting — check for concurrent processes using the same org credential."
        );
      }
      consecutiveErrors++;
      if (consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD && !consecutiveAlertFired) {
        consecutiveAlertFired = true;
        sendSlackAlert(
          `🔴 ${CONSECUTIVE_ERROR_THRESHOLD} consecutive Gong API errors — possible outage or credential issue.`
        );
      }
      throw new GongApiError(response.status, `Gong API error ${response.status}: ${text}`);
    }

    consecutiveErrors = 0;
    consecutiveAlertFired = false;
    quotaTracker.increment();
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

  // aggregationPeriod is a TOP-LEVEL body field (sibling of filter) with
  // uppercase values: DAY | WEEK | MONTH | QUARTER (verified live 2026-06-12).
  getActivityAggregateByPeriod(body: { filter: Record<string, unknown>; aggregationPeriod?: string }) {
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
  // Live-verified 2026-06-12: both endpoints take crmEntityType (ACCOUNT |
  // DEAL) and a REQUIRED timePeriod enum (THIS_WEEK | THIS_MONTH |
  // THIS_QUARTER | THIS_YEAR) — arbitrary fromDateTime/toDateTime ranges are
  // not supported.

  askAccount(params: {
    workspaceId: string;
    crmAccountId: string;
    timePeriod: string;
    question: string;
  }) {
    return this.request(
      `/v2/entities/ask-entity${this.qs({
        workspaceId: params.workspaceId,
        crmEntityType: "ACCOUNT",
        crmEntityId: params.crmAccountId,
        timePeriod: params.timePeriod,
        question: params.question,
      })}`
    );
  }

  askDeal(params: {
    workspaceId: string;
    crmDealId: string;
    timePeriod: string;
    question: string;
  }) {
    return this.request(
      `/v2/entities/ask-entity${this.qs({
        workspaceId: params.workspaceId,
        crmEntityType: "DEAL",
        crmEntityId: params.crmDealId,
        timePeriod: params.timePeriod,
        question: params.question,
      })}`
    );
  }

  /** `briefName` must match a PUBLISHED brief template in Gong (the API 404s
   * otherwise — "Brief not found - could be that the brief is not published"). */
  generateBrief(params: {
    workspaceId: string;
    briefName: string;
    crmEntityType: "ACCOUNT" | "DEAL" | "CONTACT" | "LEAD";
    crmEntityId: string;
    timePeriod: string;
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

  /** In a multi-workspace org the bare endpoint 400s — pass a workspaceId. */
  listLibraryFolders(workspaceId?: string) {
    return this.request(`/v2/library/folders${this.qs({ workspaceId })}`);
  }

  getLibraryFolderContent(folderId: string, cursor?: string) {
    return this.request(`/v2/library/folder-content${this.qs({ folderId, cursor })}`);
  }

  // ── CRM ──────────────────────────────────────────────────────────────────
  // These cover integrations registered through the generic CRM API (an
  // `integrationId` long is required everywhere) — NOT native connectors like
  // the built-in Salesforce sync. Verified live 2026-06-12.

  getCrmEntities(params: { integrationId: string; objectType: string; objectIds?: string[]; cursor?: string }) {
    return this.request(`/v2/crm/entities${this.qs(params)}`);
  }

  upsertCrmEntities(body: unknown) {
    return this.request("/v2/crm/entities", { method: "POST", body: JSON.stringify(body) });
  }

  getCrmEntitySchema(params: { integrationId: string; objectType: string }) {
    return this.request(`/v2/crm/entity-schema${this.qs(params)}`);
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

  getCrmRequestStatus(params: { integrationId: string; clientRequestId: string }) {
    return this.request(`/v2/crm/request-status${this.qs(params)}`);
  }

  // ── Logs ─────────────────────────────────────────────────────────────────

  /** `logType` is required by the API; "UserActivityLog" is the standard
   * audit log (verified live 2026-06-12). */
  getLogs(params: { logType: string; fromDateTime?: string; toDateTime?: string; cursor?: string }) {
    return this.request(`/v2/logs${this.qs(params)}`);
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
  // Both list endpoints require the owner's email (verified live 2026-06-12)
  // and 403 when that user has no Gong Engage license.

  listFlows(params: { flowOwnerEmail: string; workspaceId?: string; cursor?: string }) {
    return this.request(`/v2/flows${this.qs(params)}`);
  }

  listFlowFolders(params: { flowFolderOwnerEmail: string; workspaceId?: string; cursor?: string }) {
    return this.request(`/v2/flows/folders${this.qs(params)}`);
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

  /** Coaching metrics are manager-centric. The API requires kebab-case query
   * params — workspace-id, manager-id — and an ISO OffsetDateTime range
   * (verified live 2026-06-12; date-only values are rejected here, unlike the
   * stats endpoints). */
  getCoaching(params: { workspaceId: string; managerId?: string; from: string; to: string }) {
    return this.request(`/v2/coaching${this.qs({
      "workspace-id": params.workspaceId,
      "manager-id": params.managerId,
      from: params.from,
      to: params.to,
    })}`);
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
