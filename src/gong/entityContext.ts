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
  findCalls,
  findCallsByCrmObject,
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

function clampMaxCalls(maxCalls?: number): number {
  return Math.min(Math.max(Math.trunc(maxCalls ?? DEFAULT_MAX_CALLS), 1), MAX_MAX_CALLS);
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

  const found: FindCallsResult =
    opts.crmEntityType === "ACCOUNT" || opts.crmEntityType === "DEAL"
      ? await findCallsByCrmObject(client, { crmObjectId: opts.entityRef, ...range, workspaceId: opts.workspaceId })
      : await findCalls(client, { participant: opts.entityRef, ...range, workspaceId: opts.workspaceId });

  const ids = found.calls.slice(0, clampMaxCalls(opts.maxCalls)).map((c) => c.id);

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

  const note = [found.note, found.policyNote, transcriptNote].filter(Boolean).join(" ") || undefined;

  return {
    entity: { crmEntityType: opts.crmEntityType, entityRef: opts.entityRef },
    period: range,
    calls,
    coverage: found.coverage,
    ...(note ? { note } : {}),
  };
}
