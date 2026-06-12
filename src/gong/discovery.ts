/**
 * Call-discovery engine: server-side scan-and-filter over /v2/calls/extensive.
 *
 * The Gong API has no search endpoint and no participant filter, so "calls
 * Nikki was on" requires paging the extensive endpoint with parties exposed and
 * matching client-side. This module owns that loop so tools can answer
 * people/client questions in one call with compact output.
 *
 * Always called with the session's injected client: PolicyGongClient and
 * ScopedGongClient both override getExtensiveCalls to filter each page to the
 * caller's visible set, so everything built here is policy-safe by
 * construction. Consequence: `scannedCalls` counts post-policy-visible calls
 * (pages may be sparse for restricted users), while `totalCallsInRange` is the
 * API's raw pre-policy count.
 *
 * Field shapes were verified against the live API on 2026-06-12 — see
 * docs/backlog-call-discovery-tools.md "Live verification findings".
 */
import { GongApiError, type GongClient } from "./client.js";
import type { GongIdentity } from "./identity.js";
import { scanPages } from "./pagination.js";
import { loadUserDirectory, matchDirectoryUsers } from "./directory.js";

// ── API shapes (every accessor optional-chained — the live API is the contract) ──

export interface ExtensiveParty {
  userId?: string | number;
  emailAddress?: string;
  name?: string;
  /** "Internal" | "External" | "Unknown" on the live API. */
  affiliation?: string;
  title?: string;
}

interface CrmField { name?: string; value?: unknown }
interface CrmObject { objectType?: string; objectId?: string; fields?: CrmField[] }
interface CrmContext { system?: string; objects?: CrmObject[] }

export interface ExtensiveCallRecord {
  metaData?: {
    id?: string | number;
    url?: string;
    title?: string;
    started?: string;
    duration?: number;
    direction?: string;
    scope?: string;
    media?: string;
    language?: string;
    workspaceId?: string | number;
    primaryUserId?: string | number;
  };
  parties?: ExtensiveParty[];
  context?: CrmContext[];
  content?: {
    topics?: Array<{ name?: string; duration?: number }>;
    trackers?: Array<{ name?: string; count?: number }>;
    brief?: string;
    keyPoints?: unknown;
    callOutcome?: unknown;
    nextSteps?: unknown;
  };
}

interface ExtensiveCallsPage {
  calls?: ExtensiveCallRecord[];
  records?: { totalRecords?: number; currentPageSize?: number; cursor?: string };
  /** Added by the policy clients when they filter a page. */
  note?: string;
}

// ── Matching ──────────────────────────────────────────────────────────────────

export interface ParticipantSpec {
  /** Resolved Gong userIds (directory matches, or the session user for my-calls). */
  userIds: Set<string>;
  /** Exact lowercase email equality (my-calls: unlinked attendee records). */
  emailExact?: string;
  /** Lowercase substring against party emails (find-calls: covers externals). */
  emailFragment?: string;
  /** Lowercase substring against party display names. */
  nameFragment?: string;
}

export type ParticipantMatchBasis = "userId" | "email" | "name";

/** Mirrors PolicyGongClient.isVisibleCall semantics: userId OR email, never just userId. */
export function partyMatchesParticipant(
  party: ExtensiveParty,
  spec: ParticipantSpec,
): ParticipantMatchBasis | null {
  if (party.userId != null && spec.userIds.has(String(party.userId))) return "userId";
  const email = party.emailAddress?.toLowerCase();
  if (email) {
    if (spec.emailExact && email === spec.emailExact) return "email";
    if (spec.emailFragment && email.includes(spec.emailFragment)) return "email";
  }
  if (spec.nameFragment && party.name?.toLowerCase().includes(spec.nameFragment)) return "name";
  return null;
}

const BASIS_RANK: Record<ParticipantMatchBasis, number> = { userId: 3, email: 2, name: 1 };

function callMatchesParticipant(call: ExtensiveCallRecord, spec: ParticipantSpec): ParticipantMatchBasis | null {
  let best: ParticipantMatchBasis | null = null;
  for (const party of call.parties ?? []) {
    const basis = partyMatchesParticipant(party, spec);
    if (basis === "userId") return basis;
    if (basis && (!best || BASIS_RANK[basis] > BASIS_RANK[best])) best = basis;
  }
  return best;
}

export type AccountMatchBasis = "crm-context" | "title" | "external-domain";

const compact = (s: string) => s.replace(/[^a-z0-9]/g, "");

/**
 * Account/client matching, in confidence order:
 *  1. CRM context — Account objects attached via contentSelector.context
 *     "Extended" (90% coverage on the live org). Field names vary per org
 *     (Name, Website, Domain__c, …) so every string field is checked.
 *  2. Call title substring.
 *  3. External participants' email domains — works with no CRM linkage at all.
 * Fragment matching also compares alphanumeric-compacted forms for CRM fields
 * and domains ("Go Nimbly" → gonimbly.com) but NOT titles, where compaction
 * would match across word boundaries.
 */
export function callMatchesAccount(
  call: ExtensiveCallRecord,
  accountQuery: string,
): { matched: boolean; on?: AccountMatchBasis } {
  const q = accountQuery.trim().toLowerCase();
  if (!q) return { matched: false };
  const qCompact = compact(q);

  for (const ctx of call.context ?? []) {
    for (const obj of ctx.objects ?? []) {
      if (obj.objectType !== "Account") continue;
      for (const field of obj.fields ?? []) {
        if (typeof field.value !== "string") continue;
        const v = field.value.toLowerCase();
        if (v.includes(q) || (qCompact && compact(v).includes(qCompact))) {
          return { matched: true, on: "crm-context" };
        }
      }
    }
  }

  if (call.metaData?.title?.toLowerCase().includes(q)) return { matched: true, on: "title" };

  for (const party of call.parties ?? []) {
    if (party.affiliation === "Internal") continue;
    const domain = party.emailAddress?.toLowerCase().split("@")[1];
    if (!domain) continue;
    if (domain.includes(q) || (qCompact && compact(domain).includes(qCompact))) {
      return { matched: true, on: "external-domain" };
    }
  }

  return { matched: false };
}

/** CRM Account display names attached to the call, when context was requested. */
function accountNames(call: ExtensiveCallRecord): string[] {
  const names: string[] = [];
  for (const ctx of call.context ?? []) {
    for (const obj of ctx.objects ?? []) {
      if (obj.objectType !== "Account") continue;
      const name = obj.fields?.find((f) => f.name === "Name" && typeof f.value === "string")?.value;
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}

// ── Compact output ────────────────────────────────────────────────────────────

export interface CompactParticipant {
  name?: string;
  email?: string;
  userId?: string;
  affiliation?: string;
}

export interface CompactCall {
  id: string;
  url?: string;
  title?: string;
  started?: string;
  durationSec?: number;
  direction?: string;
  workspaceId?: string;
  primaryUserId?: string;
  account?: string;
  participants: CompactParticipant[];
  matchedOn: string[];
}

export interface FindCallsResult {
  calls: CompactCall[];
  coverage: {
    /** Calls examined — what THIS session may see across the scanned pages. */
    scannedCalls: number;
    /** Matches before the display cap. */
    matchedCalls: number;
    pagesScanned: number;
    /** True iff the scan stopped at maxPages with more pages remaining. */
    truncated: boolean;
    /** The API's raw call count for the range, BEFORE policy filtering. */
    totalCallsInRange?: number;
  };
  participantResolution?: {
    query: string;
    matchedUsers: Array<{ userId: string; name: string; email: string }>;
    ambiguous: boolean;
    note?: string;
  };
  policyNote?: string;
  note?: string;
}

function compactParty(p: ExtensiveParty): CompactParticipant {
  return {
    name: p.name,
    email: p.emailAddress,
    userId: p.userId != null ? String(p.userId) : undefined,
    affiliation: p.affiliation,
  };
}

function toCompactCall(call: ExtensiveCallRecord, matchedOn: string[]): CompactCall {
  const meta = call.metaData ?? {};
  const account = accountNames(call)[0];
  return {
    id: String(meta.id),
    url: meta.url,
    title: meta.title,
    started: meta.started,
    durationSec: meta.duration,
    direction: meta.direction,
    workspaceId: meta.workspaceId != null ? String(meta.workspaceId) : undefined,
    primaryUserId: meta.primaryUserId != null ? String(meta.primaryUserId) : undefined,
    ...(account ? { account } : {}),
    participants: (call.parties ?? []).map(compactParty),
    matchedOn,
  };
}

// ── Scan core ─────────────────────────────────────────────────────────────────

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_PAGES = 5;
const MAX_MAX_PAGES = 10;
const DISPLAY_CAP = 50;

export interface FindCallsOptions {
  participant?: string;
  account?: string;
  titleContains?: string;
  fromDateTime?: string;
  toDateTime?: string;
  workspaceId?: string;
  maxPages?: number;
}

// Gong 404s ("No calls found corresponding to the provided filters") on a
// valid filter with zero matches — that is an empty result, not an error. The
// text check distinguishes it from other 404s (e.g. a misconfigured base URL).
function isNoCallsFound(err: unknown): boolean {
  return err instanceof GongApiError && err.status === 404 && /No calls found/i.test(err.message);
}

interface ScanSpec {
  participant?: ParticipantSpec;
  account?: string;
  titleContains?: string;
  fromDateTime: string;
  toDateTime: string;
  workspaceId?: string;
  maxPages: number;
  withCrmContext: boolean;
}

async function scanCalls(client: GongClient, spec: ScanSpec): Promise<Omit<FindCallsResult, "participantResolution">> {
  const contentSelector: Record<string, unknown> = {
    // Explicit even though the policy clients force it for restricted users:
    // unrestricted sessions hit their passthrough branch, where nothing else
    // would expose parties.
    exposedFields: { parties: true },
    ...(spec.withCrmContext ? { context: "Extended" } : {}),
  };

  let scan;
  try {
    scan = await scanPages<ExtensiveCallsPage>(
      (cursor) => client.getExtensiveCalls({
        filter: {
          fromDateTime: spec.fromDateTime,
          toDateTime: spec.toDateTime,
          ...(spec.workspaceId ? { workspaceId: spec.workspaceId } : {}),
        },
        contentSelector,
        ...(cursor ? { cursor } : {}),
      }) as Promise<ExtensiveCallsPage>,
      spec.maxPages,
    );
  } catch (err) {
    if (isNoCallsFound(err)) {
      return {
        calls: [],
        coverage: { scannedCalls: 0, matchedCalls: 0, pagesScanned: 0, truncated: false, totalCallsInRange: 0 },
      };
    }
    throw err;
  }

  const titleQuery = spec.titleContains?.trim().toLowerCase();
  const seen = new Set<string>();
  const matches: CompactCall[] = [];
  let scannedCalls = 0;

  for (const page of scan.pages) {
    for (const call of page.calls ?? []) {
      const id = call.metaData?.id;
      if (id == null || seen.has(String(id))) continue;
      seen.add(String(id));
      scannedCalls++;

      const matchedOn: string[] = [];
      if (spec.participant) {
        const basis = callMatchesParticipant(call, spec.participant);
        if (!basis) continue;
        matchedOn.push(`participant:${basis}`);
      }
      if (spec.account) {
        const { matched, on } = callMatchesAccount(call, spec.account);
        if (!matched) continue;
        matchedOn.push(`account:${on}`);
      }
      if (titleQuery) {
        if (!call.metaData?.title?.toLowerCase().includes(titleQuery)) continue;
        matchedOn.push("title");
      }
      matches.push(toCompactCall(call, matchedOn));
    }
  }

  matches.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
  const capped = matches.slice(0, DISPLAY_CAP);

  return {
    calls: capped,
    coverage: {
      scannedCalls,
      matchedCalls: matches.length,
      pagesScanned: scan.pagesScanned,
      truncated: scan.truncated,
      totalCallsInRange: scan.totalRecords,
    },
    ...(scan.pages[0]?.note ? { policyNote: scan.pages[0].note } : {}),
    ...(matches.length > DISPLAY_CAP
      ? { note: `Showing ${DISPLAY_CAP} of ${matches.length} matches — narrow the date range or refine the filters.` }
      : {}),
  };
}

function resolveRange(opts: { fromDateTime?: string; toDateTime?: string }): { fromDateTime: string; toDateTime: string } {
  return {
    fromDateTime: opts.fromDateTime ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400_000).toISOString(),
    toDateTime: opts.toDateTime ?? new Date().toISOString(),
  };
}

function clampMaxPages(maxPages?: number): number {
  return Math.min(Math.max(Math.trunc(maxPages ?? DEFAULT_MAX_PAGES), 1), MAX_MAX_PAGES);
}

// ── Public entry points ───────────────────────────────────────────────────────

export async function findCalls(client: GongClient, opts: FindCallsOptions): Promise<FindCallsResult> {
  const participantQuery = opts.participant?.trim();
  const accountQuery = opts.account?.trim();
  const titleQuery = opts.titleContains?.trim();

  if (!participantQuery && !accountQuery && !titleQuery) {
    throw new Error(
      "Provide at least one of participant, account, or titleContains. " +
      "To list calls in a date range use gong_list_calls; for your own calls use gong_my_calls."
    );
  }

  let participant: ParticipantSpec | undefined;
  let participantResolution: FindCallsResult["participantResolution"];
  if (participantQuery) {
    const q = participantQuery.toLowerCase();
    const isUserId = /^\d+$/.test(q);
    const directoryMatches = matchDirectoryUsers(await loadUserDirectory(client), q);
    participant = {
      // A numeric query is an exact userId — honored even when the directory
      // no longer lists that user (departed reps still appear on old calls).
      userIds: new Set([...directoryMatches.map((u) => u.userId), ...(isUserId ? [q] : [])]),
      // Fragments cover external attendees and unlinked party records, which
      // are not in the directory. Meaningless for a numeric id.
      ...(isUserId ? {} : { emailFragment: q, nameFragment: q }),
    };
    participantResolution = {
      query: participantQuery,
      matchedUsers: directoryMatches.slice(0, 10).map((u) => ({ userId: u.userId, name: u.fullName, email: u.email })),
      ambiguous: directoryMatches.length > 1,
      note:
        directoryMatches.length === 0
          ? isUserId
            ? `"${participantQuery}" is not in the Gong user directory — matching call participants by exact userId.`
            : `"${participantQuery}" matched no Gong user — matching call participants by email/name fragment instead (covers external attendees).`
          : directoryMatches.length > 1
            ? `"${participantQuery}" matched ${directoryMatches.length} Gong users; results include calls for all of them. ` +
              `Use gong_find_user and re-run with the exact email to disambiguate.`
            : undefined,
    };
  }

  const result = await scanCalls(client, {
    participant,
    account: accountQuery,
    titleContains: titleQuery,
    ...resolveRange(opts),
    workspaceId: opts.workspaceId,
    maxPages: clampMaxPages(opts.maxPages),
    withCrmContext: Boolean(accountQuery),
  });

  return participantResolution ? { ...result, participantResolution } : result;
}

export async function findMyCalls(
  client: GongClient,
  identity: GongIdentity,
  opts: Pick<FindCallsOptions, "fromDateTime" | "toDateTime" | "workspaceId" | "maxPages">,
): Promise<FindCallsResult> {
  // Exact-email semantics deliberately mirror ScopedGongClient.isParty /
  // PolicyGongClient.isVisibleCall: the session user matches by userId or by
  // their own email on unlinked attendee records — never by fragment.
  return scanCalls(client, {
    participant: { userIds: new Set([identity.userId]), emailExact: identity.email },
    ...resolveRange(opts),
    workspaceId: opts.workspaceId,
    maxPages: clampMaxPages(opts.maxPages),
    withCrmContext: false,
  });
}

// ── Call summary ──────────────────────────────────────────────────────────────

export interface CallDigest {
  id: string;
  url?: string;
  title?: string;
  started?: string;
  durationSec?: number;
  direction?: string;
  scope?: string;
  media?: string;
  language?: string;
  workspaceId?: string;
  account?: string;
  participants: Array<CompactParticipant & { title?: string }>;
  outcome?: string;
  brief?: string;
  keyPoints?: string[];
  nextSteps?: string[];
  topics?: Array<{ name?: string; durationSec?: number }>;
  trackers?: Array<{ name?: string; count?: number }>;
}

const toText = (v: unknown): string | undefined => {
  if (typeof v === "string") return v || undefined;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text || undefined;
    if (typeof o.name === "string") return o.name || undefined;
  }
  return undefined;
};

const toTextArray = (v: unknown): string[] | undefined => {
  const items = (Array.isArray(v) ? v : [v]).map(toText).filter((s): s is string => Boolean(s));
  return items.length ? items : undefined;
};

export async function summarizeCall(client: GongClient, callId: string): Promise<CallDigest> {
  const notVisible = () =>
    new Error(`Call ${callId} was not found or is not visible to your Gong permission profile.`);

  let data: ExtensiveCallsPage;
  try {
    data = await client.getExtensiveCalls({
      filter: { callIds: [callId] },
      contentSelector: {
        context: "Extended",
        exposedFields: {
          parties: true,
          content: {
            topics: true,
            trackers: true,
            brief: true,
            keyPoints: true,
            callOutcome: true,
            nextSteps: true,
          },
        },
      },
    }) as ExtensiveCallsPage;
  } catch (err) {
    if (isNoCallsFound(err)) throw notVisible();
    throw err;
  }

  // Both policy clients silently filter this endpoint, so an empty page means
  // missing OR hidden — same answer either way.
  const call = (data.calls ?? [])[0];
  if (!call) throw notVisible();

  const meta = call.metaData ?? {};
  const content = call.content ?? {};
  const topics = (content.topics ?? [])
    .filter((t) => (t.duration ?? 0) > 0)
    .map((t) => ({ name: t.name, durationSec: t.duration }));
  const trackers = (content.trackers ?? [])
    .filter((t) => (t.count ?? 0) > 0)
    .map((t) => ({ name: t.name, count: t.count }));
  const account = accountNames(call)[0];

  return {
    id: String(meta.id ?? callId),
    url: meta.url,
    title: meta.title,
    started: meta.started,
    durationSec: meta.duration,
    direction: meta.direction,
    scope: meta.scope,
    media: meta.media,
    language: meta.language,
    workspaceId: meta.workspaceId != null ? String(meta.workspaceId) : undefined,
    ...(account ? { account } : {}),
    participants: (call.parties ?? []).map((p) => ({ ...compactParty(p), title: p.title })),
    outcome: toText(content.callOutcome),
    brief: content.brief || undefined,
    keyPoints: toTextArray(content.keyPoints),
    nextSteps: toTextArray(content.nextSteps),
    ...(topics.length ? { topics } : {}),
    ...(trackers.length ? { trackers } : {}),
  };
}
