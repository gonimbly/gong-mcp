/**
 * Phase 3: resolve a gateway user's Gong permission profile into a UserPolicy.
 *
 * Gong's REST API is org-wide; the UI applies per-user access via permission
 * profiles. This module mirrors that model: an org-wide snapshot (workspaces →
 * profiles → member userIds, plus the manager graph) is cached for an hour, and
 * each session resolves its user into per-workspace domain access + capability
 * gates. See docs/phase3-access-control-plan.md and docs/phase3a-discovery.md.
 *
 * Fail closed: any resolution failure must degrade the session to the Phase 2
 * member policy (own calls/stats only) — never to open access. This module
 * throws PolicyResolutionError; the caller picks the degraded policy.
 */
import type { GongClient } from "./client.js";

export type PermissionLevel = "all" | "managers-team" | "report-to-them" | "none";

export interface DomainAccess {
  level: PermissionLevel;
  /** null = unrestricted ("all"); otherwise the exact set of visible Gong userIds. */
  visibleUserIds: Set<string> | null;
}

export interface PolicyCapabilities {
  downloadCallMedia: boolean;
  privateCalls: boolean;
  manageScorecards: boolean;
  /** crmDataImport || crmDataInlineEditing */
  crmWrite: boolean;
  /** manageGeneralBusinessSettings — gates org-admin tools */
  techAdmin: boolean;
  /** manuallyScheduleAndUploadCalls — gates call/meeting creation */
  scheduleCalls: boolean;
}

export interface WorkspacePolicy {
  workspaceId: string;
  profileId: string;
  profileName: string;
  calls: DomainAccess;
  deals: DomainAccess;
  coaching: DomainAccess;
  /** From insightsAccess — scope for all stats tools (see plan's mapping table). */
  stats: DomainAccess;
  library: { level: "all" | "selected" | "none"; folderIds: Set<string> | null };
}

export interface UserPolicy {
  userId: string;
  email: string;
  /** Workspaces where the user holds a profile. */
  workspaceIds: string[];
  perWorkspace: Map<string, WorkspacePolicy>;
  /** OR across workspaces — the user can perform the action somewhere in the UI. */
  capabilities: PolicyCapabilities;
  /** True when this policy is the fail-closed Phase 2 fallback, not profile-derived. */
  degraded: boolean;
}

export class PolicyResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyResolutionError";
  }
}

// ── Raw API shapes (only the fields we consume) ──────────────────────────────

interface RawDomainAccess {
  permissionLevel?: PermissionLevel;
  teamLeadIds?: string[] | null;
}

interface RawProfile {
  id: string;
  name?: string;
  callsAccess?: RawDomainAccess;
  dealsAccess?: RawDomainAccess;
  coachingAccess?: RawDomainAccess;
  insightsAccess?: RawDomainAccess;
  usageAccess?: RawDomainAccess;
  libraryFolderAccess?: { permissionLevel?: string; libraryFolderIds?: string[] | null };
  downloadCallMedia?: boolean;
  privateCalls?: boolean;
  manageScorecards?: boolean;
  crmDataImport?: boolean;
  crmDataInlineEditing?: boolean;
  manageGeneralBusinessSettings?: boolean;
  manuallyScheduleAndUploadCalls?: boolean;
}

interface Snapshot {
  builtAt: number;
  /** workspaceId → profiles in that workspace */
  profilesByWorkspace: Map<string, RawProfile[]>;
  /** profileId → member userIds */
  profileMembers: Map<string, Set<string>>;
  /** userId → managerId (active users only) */
  managerOf: Map<string, string>;
}

const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1h — accepted profile-edit propagation delay
const SNAPSHOT_MAX_STALE_MS = 4 * 60 * 60 * 1000; // serve stale on refresh failure, capped

/** The Phase 2 member policy: own calls/stats only, no writes. Used when resolution fails. */
export function degradedPolicy(userId: string, email: string): UserPolicy {
  const self = () => ({ level: "report-to-them" as const, visibleUserIds: new Set([userId]) });
  const ws: WorkspacePolicy = {
    workspaceId: "*",
    profileId: "degraded",
    profileName: "degraded (Phase 2 member fallback)",
    calls: self(),
    deals: self(),
    coaching: self(),
    stats: self(),
    library: { level: "all", folderIds: null }, // library reads were open in Phase 2
  };
  return {
    userId,
    email,
    workspaceIds: ["*"],
    perWorkspace: new Map([["*", ws]]),
    capabilities: {
      downloadCallMedia: false,
      privateCalls: false,
      manageScorecards: false,
      crmWrite: false,
      techAdmin: false,
      scheduleCalls: false,
    },
    degraded: true,
  };
}

export class PermissionResolver {
  private snapshot: Snapshot | null = null;
  private refreshPromise: Promise<Snapshot> | null = null;

  constructor(
    private readonly client: GongClient,
    private readonly opts: { ttlMs?: number; maxStaleMs?: number } = {}
  ) {}

  private get ttlMs(): number {
    return this.opts.ttlMs ?? SNAPSHOT_TTL_MS;
  }

  private get maxStaleMs(): number {
    return this.opts.maxStaleMs ?? SNAPSHOT_MAX_STALE_MS;
  }

  /** Resolve a user's policy from the cached org snapshot. Throws PolicyResolutionError. */
  async resolvePolicy(userId: string, email: string): Promise<UserPolicy> {
    const snapshot = await this.getSnapshot();

    const perWorkspace = new Map<string, WorkspacePolicy>();
    const matchedProfiles: RawProfile[] = [];
    for (const [workspaceId, profiles] of snapshot.profilesByWorkspace) {
      const profile = profiles.find((p) => snapshot.profileMembers.get(p.id)?.has(userId));
      if (!profile) continue;
      matchedProfiles.push(profile);
      perWorkspace.set(workspaceId, this.buildWorkspacePolicy(workspaceId, profile, userId, snapshot));
    }

    if (perWorkspace.size === 0) {
      throw new PolicyResolutionError(
        `User ${email} (${userId}) is not a member of any permission profile`
      );
    }

    const cap = (f: (p: RawProfile) => boolean | undefined) => matchedProfiles.some((p) => f(p) === true);
    return {
      userId,
      email,
      workspaceIds: [...perWorkspace.keys()],
      perWorkspace,
      capabilities: {
        downloadCallMedia: cap((p) => p.downloadCallMedia),
        privateCalls: cap((p) => p.privateCalls),
        manageScorecards: cap((p) => p.manageScorecards),
        crmWrite: cap((p) => p.crmDataImport) || cap((p) => p.crmDataInlineEditing),
        techAdmin: cap((p) => p.manageGeneralBusinessSettings),
        scheduleCalls: cap((p) => p.manuallyScheduleAndUploadCalls),
      },
      degraded: false,
    };
  }

  private buildWorkspacePolicy(
    workspaceId: string,
    profile: RawProfile,
    userId: string,
    snapshot: Snapshot
  ): WorkspacePolicy {
    const domain = (raw: RawDomainAccess | undefined, opts?: { includeSelf?: boolean }): DomainAccess => {
      const level = raw?.permissionLevel ?? "none";
      let visible: Set<string> | null;
      switch (level) {
        case "all":
          visible = null; // unrestricted; teamLeadIds is vestigial UI state here
          break;
        case "managers-team":
          // The lead plus their transitive reports, unioned across all leads.
          visible = this.expandReports(raw?.teamLeadIds ?? [], snapshot, { includeLeads: true });
          break;
        case "report-to-them":
          // Explicit leads: their transitive reports (leads excluded — see 3a Q1).
          // No leads: transitive reports of the user themself.
          visible = this.expandReports(raw?.teamLeadIds ?? [userId], snapshot, { includeLeads: false });
          break;
        case "none":
        default:
          visible = new Set();
          break;
      }
      if (visible && opts?.includeSelf) visible.add(userId);
      return { level, visibleUserIds: visible };
    };

    const libLevelRaw = profile.libraryFolderAccess?.permissionLevel ?? "none";
    const libFolderIds = profile.libraryFolderAccess?.libraryFolderIds;
    const library: WorkspacePolicy["library"] =
      libLevelRaw === "none"
        ? { level: "none", folderIds: null }
        : libFolderIds && libFolderIds.length > 0
          ? { level: "selected", folderIds: new Set(libFolderIds) }
          : { level: "all", folderIds: null };

    return {
      workspaceId,
      profileId: profile.id,
      profileName: profile.name ?? profile.id,
      calls: domain(profile.callsAccess, { includeSelf: true }), // the UI always shows your own calls
      deals: domain(profile.dealsAccess),
      coaching: domain(profile.coachingAccess, { includeSelf: true }),
      stats: domain(profile.insightsAccess, { includeSelf: true }),
      library,
    };
  }

  private expandReports(
    leadIds: string[],
    snapshot: Snapshot,
    opts: { includeLeads: boolean }
  ): Set<string> {
    const children = new Map<string, string[]>();
    for (const [child, manager] of snapshot.managerOf) {
      const list = children.get(manager);
      if (list) list.push(child);
      else children.set(manager, [child]);
    }
    // Union of strict transitive reports across all leads. A lead stays visible
    // even when includeLeads is false if they happen to report to another lead.
    const reports = new Set<string>();
    const stack = [...leadIds];
    const expanded = new Set<string>(leadIds);
    while (stack.length > 0) {
      for (const report of children.get(stack.pop()!) ?? []) {
        reports.add(report);
        if (!expanded.has(report)) {
          expanded.add(report);
          stack.push(report);
        }
      }
    }
    if (opts.includeLeads) for (const lead of leadIds) reports.add(lead);
    return reports;
  }

  // ── Org snapshot (cached, deduplicated refresh) ────────────────────────────

  private async getSnapshot(): Promise<Snapshot> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.builtAt < this.ttlMs) return this.snapshot;

    if (!this.refreshPromise) {
      this.refreshPromise = this.buildSnapshot().finally(() => {
        this.refreshPromise = null;
      });
    }

    try {
      this.snapshot = await this.refreshPromise;
      return this.snapshot;
    } catch (err) {
      // Serve a stale snapshot for a bounded window rather than degrading everyone,
      // but never beyond maxStaleMs — beyond that, fail closed.
      if (this.snapshot && now - this.snapshot.builtAt < this.maxStaleMs) {
        console.error(
          `[policy] snapshot refresh failed, serving stale (${Math.round((now - this.snapshot.builtAt) / 60000)}m old): ` +
          `${err instanceof Error ? err.message : err}`
        );
        return this.snapshot;
      }
      throw new PolicyResolutionError(
        `Permission snapshot unavailable: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  private async buildSnapshot(): Promise<Snapshot> {
    const { workspaces } = (await this.client.listWorkspaces()) as {
      workspaces?: Array<{ id: string }>;
    };
    if (!workspaces || workspaces.length === 0) {
      throw new Error("Gong returned no workspaces");
    }

    const profilesByWorkspace = new Map<string, RawProfile[]>();
    for (const ws of workspaces) {
      const { profiles } = (await this.client.listAllPermissionProfiles(ws.id)) as {
        profiles?: RawProfile[];
      };
      profilesByWorkspace.set(ws.id, profiles ?? []);
    }

    const profileMembers = new Map<string, Set<string>>();
    for (const profiles of profilesByWorkspace.values()) {
      for (const profile of profiles) {
        const { users } = (await this.client.getPermissionProfileUsers(profile.id)) as {
          users?: Array<{ id: string }>;
        };
        profileMembers.set(profile.id, new Set((users ?? []).map((u) => String(u.id))));
      }
    }

    const managerOf = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = (await this.client.getExtensiveUsers(cursor ? { cursor } : {})) as {
        users?: Array<{ id: string; managerId?: string | null; active?: boolean }>;
        records?: { cursor?: string };
      };
      for (const user of page.users ?? []) {
        if (user.managerId && user.active !== false) {
          managerOf.set(String(user.id), String(user.managerId));
        }
      }
      cursor = page.records?.cursor;
    } while (cursor);

    console.error(
      `[policy] snapshot built: ${workspaces.length} workspaces, ` +
      `${[...profilesByWorkspace.values()].reduce((n, p) => n + p.length, 0)} profiles, ` +
      `${managerOf.size} manager edges`
    );
    return { builtAt: Date.now(), profilesByWorkspace, profileMembers, managerOf };
  }
}
