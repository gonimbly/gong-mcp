/**
 * Credit-free local equivalent of Gong's paid AI entity endpoints
 * (/v2/entities/ask-entity, /v2/entities/get-brief — see docs/local-ai-mimic-design.md).
 *
 * Instead of calling Gong's metered AI, this aggregates the recent call activity
 * for one CRM entity into a single context block and hands it back to the MCP
 * client's own model, which answers questions or writes a brief from it. Every
 * field here comes from endpoints we already pay nothing extra for: the call scan
 * (/v2/calls/extensive) and, optionally, transcripts (/v2/calls/transcript).
 *
 * Entity → call linkage:
 *   ACCOUNT / DEAL  → exact Salesforce objectId match on each call's crmRefs
 *                     (findCallsByCrmObject).
 *   CONTACT / LEAD  → the person's email matched against call participants
 *                     (findCalls by participant) — calls carry no contact/lead crmRef.
 */
import type { GongClient } from "./client.js";
import {
  findCallsByCrmObject,
  findCallsByParticipantEmail,
  summarizeCalls,
  type CallDigest,
  type FindCallsResult,
} from "./discovery.js";
import { attributeTranscripts, type AttributedTranscript } from "./transcripts.js";

export type EntityType = "ACCOUNT" | "DEAL" | "CONTACT" | "LEAD";

export interface EntityContextOptions {
  crmEntityType: EntityType;
  /** ACCOUNT/DEAL: the Salesforce Account/Opportunity id (from crmRefs).
   *  CONTACT/LEAD: the person's email address. */
  entityRef: string;
  fromDateTime?: string;
  toDateTime?: string;
  workspaceId?: string;
  /** Cap on calls enriched into the context block (newest first). */
  maxCalls?: number;
  /** Attach speaker-attributed transcripts for each call (more tokens). */
  includeTranscripts?: boolean;
  /** Scan page budget (100 calls/page) for resolving the entity's calls — higher
   * reaches further back on busy accounts but is slower. Forwarded to the scanner. */
  maxPages?: number;
}

export type EntityContextCall = CallDigest & { transcript?: AttributedTranscript };

export interface EntityContextResult {
  entity: { crmEntityType: EntityType; entityRef: string };
  period: { fromDateTime?: string; toDateTime?: string };
  calls: EntityContextCall[];
  coverage: FindCallsResult["coverage"];
  note?: string;
}

const DEFAULT_MAX_CALLS = 10;
const MAX_MAX_CALLS = 25;
// includeTranscripts attaches the full transcript per call (hundreds of KB for
// ~10 calls — measured live), so cap the call count harder when transcripts are
// requested to keep the response within a sane token budget.
const TRANSCRIPT_MAX_CALLS = 5;

function clampMaxCalls(maxCalls?: number): number {
  return Math.min(Math.max(Math.trunc(maxCalls ?? DEFAULT_MAX_CALLS), 1), MAX_MAX_CALLS);
}

/** Effective cap on enriched calls: the requested/clamped maxCalls, lowered to
 * TRANSCRIPT_MAX_CALLS when transcripts are attached so the payload stays bounded. */
export function effectiveMaxCalls(maxCalls: number | undefined, includeTranscripts: boolean): number {
  const base = clampMaxCalls(maxCalls);
  return includeTranscripts ? Math.min(base, TRANSCRIPT_MAX_CALLS) : base;
}

/**
 * Resolve an entity's recent calls, enrich the newest `maxCalls` into full
 * digests (one batched extensive request), and optionally attach transcripts.
 * The session's policy client filters every underlying call, so the result only
 * ever contains calls the caller may see.
 */
export async function aggregateEntityContext(
  client: GongClient,
  opts: EntityContextOptions,
): Promise<EntityContextResult> {
  const range = { fromDateTime: opts.fromDateTime, toDateTime: opts.toDateTime };
  const findOpts = { ...range, workspaceId: opts.workspaceId, maxPages: opts.maxPages };

  const found: FindCallsResult =
    opts.crmEntityType === "ACCOUNT" || opts.crmEntityType === "DEAL"
      ? await findCallsByCrmObject(client, { crmObjectId: opts.entityRef, ...findOpts })
      : await findCallsByParticipantEmail(client, { email: opts.entityRef, ...findOpts });

  const ids = found.calls.slice(0, effectiveMaxCalls(opts.maxCalls, Boolean(opts.includeTranscripts))).map((c) => c.id);

  const digests = (await summarizeCalls(client, ids))
    .sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));

  let transcriptNote: string | undefined;
  let calls: EntityContextCall[] = digests;
  if (opts.includeTranscripts && ids.length) {
    const { callTranscripts, note } = await attributeTranscripts(client, ids);
    transcriptNote = note;
    const byCall = new Map(callTranscripts.map((t) => [t.callId, t]));
    calls = digests.map((d) => {
      const transcript = byCall.get(d.id);
      return transcript ? { ...d, transcript } : d;
    });
  }

  // Coverage honesty: when more calls matched than we returned (maxCalls cap, the
  // transcript cap, or the 50-result scan cap), say so — a partial context block
  // must never be mistaken for the entity's full call history. The remedies are
  // gated on what would actually help, so the advice isn't misleading.
  let coverageNote: string | undefined;
  if (found.coverage.matchedCalls > calls.length) {
    const transcriptCapBinding =
      Boolean(opts.includeTranscripts) && clampMaxCalls(opts.maxCalls) > TRANSCRIPT_MAX_CALLS;
    const moreAlreadyScanned = found.calls.length > calls.length; // raising maxCalls can surface these
    const remedies: string[] = [];
    if (transcriptCapBinding) remedies.push("omit includeTranscripts (it caps the count at 5)");
    if (moreAlreadyScanned && calls.length < MAX_MAX_CALLS) remedies.push(`raise maxCalls (max ${MAX_MAX_CALLS})`);
    remedies.push("narrow the date range");
    const advice = remedies.length > 1
      ? `${remedies.slice(0, -1).join(", ")}, or ${remedies[remedies.length - 1]}`
      : remedies[0];
    coverageNote = `Showing the ${calls.length} most recent of ${found.coverage.matchedCalls} calls linked to this entity in the window — ${advice} to see the rest.`;
  }

  const note = [found.note, found.policyNote, coverageNote, transcriptNote].filter(Boolean).join(" ") || undefined;

  return {
    entity: { crmEntityType: opts.crmEntityType, entityRef: opts.entityRef },
    period: range,
    calls,
    coverage: found.coverage,
    ...(note ? { note } : {}),
  };
}
