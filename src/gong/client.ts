export interface GongConfig {
  accessKey: string;
  accessKeySecret: string;
  baseUrl?: string;
}

export interface GongCallsFilter {
  fromDateTime?: string;
  toDateTime?: string;
  workspaceId?: string;
  callIds?: string[];
}

export interface GongUsersFilter {
  includeAvatars?: boolean;
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

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
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

  async listCalls(filter?: GongCallsFilter) {
    const body = filter
      ? {
          filter: {
            fromDateTime: filter.fromDateTime,
            toDateTime: filter.toDateTime,
            workspaceId: filter.workspaceId,
            callIds: filter.callIds,
          },
        }
      : {};

    return this.request("/v2/calls", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getCall(callId: string) {
    return this.request(`/v2/calls/${callId}`);
  }

  async getCallTranscript(callId: string) {
    return this.request(`/v2/calls/${callId}/transcript`);
  }

  async listUsers(filter?: GongUsersFilter) {
    const params = new URLSearchParams();
    if (filter?.includeAvatars) params.set("includeAvatars", "true");
    const qs = params.toString();
    return this.request(`/v2/users${qs ? `?${qs}` : ""}`);
  }

  async getUser(userId: string) {
    return this.request(`/v2/users/${userId}`);
  }

  async getUserStats(userId: string, fromDateTime: string, toDateTime: string) {
    const params = new URLSearchParams({ fromDateTime, toDateTime });
    return this.request(`/v2/stats/activity/users?${params}`);
  }

  async searchCalls(query: string, fromDateTime?: string, toDateTime?: string) {
    return this.request("/v2/calls/search", {
      method: "POST",
      body: JSON.stringify({
        filter: {
          fromDateTime,
          toDateTime,
        },
        contentSelector: {
          context: "Extended",
          exposedFields: {
            content: {
              topics: true,
              trackers: true,
              brief: true,
              keyPoints: true,
              callOutcome: true,
              nextSteps: true,
            },
            interaction: {
              speakers: true,
              personInteractionStats: true,
              questions: true,
            },
          },
          paging: { pageSize: 20 },
        },
      }),
    });
  }

  async getCallPoints(callId: string) {
    return this.request(`/v2/calls/${callId}/points-of-interest`);
  }

  async listLibraryFolders() {
    return this.request("/v2/library/folders");
  }

  async getAccountActivity(accountIds: string[], fromDateTime: string, toDateTime: string) {
    const params = new URLSearchParams({ fromDateTime, toDateTime });
    accountIds.forEach((id) => params.append("accountIds", id));
    return this.request(`/v2/stats/activity/account?${params}`);
  }
}
