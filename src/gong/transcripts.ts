/**
 * Speaker attribution for call transcripts.
 *
 * Gong's POST /v2/calls/transcript returns each monologue keyed by an opaque
 * `speakerId` and nothing else — no names. The crosswalk lives on the per-call
 * `parties` array from POST /v2/calls/extensive (parties exposed): each party
 * that spoke carries a `speakerId` matching the transcript's, plus name / email /
 * userId / affiliation / title. This module fetches both and joins them
 * server-side so the tool returns named, attributed transcripts — internal AND
 * external speakers (interaction.speakers omits externals; `parties` does not).
 *
 * Like discovery.ts, this is always called with the session's injected client.
 * getCallTranscripts and getExtensiveCalls are both policy/scope overrides, so
 * access control applies by construction. Transcripts are fetched FIRST so a
 * restricted client's deny fails closed before any parties fetch — do not
 * reorder. The transcript gate always runs a visibility + owner-only private-call
 * check (one parties fetch) so a private call's transcript can't leak, making this
 * module's roster fetch a second parties fetch on every policy path. The tool is
 * low-frequency and bounded at 100 callIds, so the extra POST is not worth
 * optimizing away (it would couple this module to policy internals).
 */
import type { GongClient } from "./client.js";
import { isNoCallsFound, type ExtensiveParty } from "./discovery.js";

// ── Raw transcript response shapes (the live API is the contract) ──────────────

interface TranscriptSentence { start?: number; end?: number; text?: string }

interface TranscriptMonologue {
  speakerId?: string | number;
  topic?: string;
  sentences?: TranscriptSentence[];
}

interface TranscriptRecord {
  callId?: string | number;
  transcript?: TranscriptMonologue[];
}

interface TranscriptResponse {
  requestId?: string;
  records?: unknown;
  callTranscripts?: TranscriptRecord[];
}

interface ExtensiveCallWithParties {
  metaData?: { id?: string | number };
  parties?: ExtensiveParty[];
}

interface ExtensiveCallsResponse { calls?: ExtensiveCallWithParties[] }

// ── Attributed output shapes ───────────────────────────────────────────────────

/** Full crosswalk entry for one speaker (a party that spoke). */
export interface SpeakerInfo {
  name?: string;
  email?: string;
  userId?: string;
  affiliation?: string;
  title?: string;
}

export interface AttributedMonologue {
  speakerId?: string;
  /** Resolved inline for top-to-bottom reading; omitted when no party matched. */
  speaker?: { name?: string; affiliation?: string };
  topic?: string;
  sentences?: TranscriptSentence[];
}

export interface AttributedTranscript {
  callId: string;
  /** speakerId → full identity. The complete roster of speakers, incl. externals. */
  speakers: Record<string, SpeakerInfo>;
  transcript: AttributedMonologue[];
  /** Monologue speakerIds that matched no party (unknown speakers); omitted when empty. */
  unattributedSpeakerIds?: string[];
}

export interface AttributeTranscriptsResult {
  callTranscripts: AttributedTranscript[];
  /** Set only when names could not be resolved at all (e.g. parties unavailable). */
  note?: string;
}

function toSpeakerInfo(p: ExtensiveParty): SpeakerInfo {
  return {
    name: p.name,
    email: p.emailAddress,
    userId: p.userId != null ? String(p.userId) : undefined,
    affiliation: p.affiliation,
    title: p.title,
  };
}

/** Per call: speakerId (stringified) → the party that spoke under it. */
function buildSpeakerMaps(calls: ExtensiveCallWithParties[]): Map<string, Map<string, ExtensiveParty>> {
  const byCall = new Map<string, Map<string, ExtensiveParty>>();
  for (const call of calls) {
    const id = call.metaData?.id;
    if (id == null) continue;
    const map = new Map<string, ExtensiveParty>();
    for (const party of call.parties ?? []) {
      if (party.speakerId == null) continue; // didn't speak → no transcript line to attribute
      map.set(String(party.speakerId), party); // String() both sides — Gong mixes string/number ids
    }
    byCall.set(String(id), map);
  }
  return byCall;
}

function attributeRecord(
  record: TranscriptRecord,
  partiesByCall: Map<string, Map<string, ExtensiveParty>>,
): AttributedTranscript {
  const callId = String(record.callId);
  const speakerMap = partiesByCall.get(callId) ?? new Map<string, ExtensiveParty>();

  const speakers: Record<string, SpeakerInfo> = {};
  for (const [speakerId, party] of speakerMap) speakers[speakerId] = toSpeakerInfo(party);

  const unattributed = new Set<string>();
  const transcript: AttributedMonologue[] = (record.transcript ?? []).map((m) => {
    const speakerId = m.speakerId != null ? String(m.speakerId) : undefined;
    const party = speakerId != null ? speakerMap.get(speakerId) : undefined;
    if (speakerId != null && !party) unattributed.add(speakerId);
    return {
      speakerId,
      ...(party ? { speaker: { name: party.name, affiliation: party.affiliation } } : {}),
      topic: m.topic,
      sentences: m.sentences,
    };
  });

  return {
    callId,
    speakers,
    transcript,
    ...(unattributed.size > 0 ? { unattributedSpeakerIds: [...unattributed] } : {}),
  };
}

/**
 * Fetch transcripts for the given calls and resolve each monologue's speakerId
 * to a named participant via that call's parties. Policy-safe via the injected
 * client. Never throws on missing parties — the transcript content is still
 * returned (unattributed) with an explanatory `note`.
 */
export async function attributeTranscripts(
  client: GongClient,
  callIds: string[],
): Promise<AttributeTranscriptsResult> {
  // Transcripts first — a restricted client denies hidden calls here, before any
  // parties fetch (fail-closed). Do not reorder.
  const transcripts = (await client.getCallTranscripts(callIds)) as TranscriptResponse;

  let partiesByCall = new Map<string, Map<string, ExtensiveParty>>();
  if (callIds.length > 0) {
    try {
      const extensive = (await client.getExtensiveCalls({
        filter: { callIds },
        contentSelector: { exposedFields: { parties: true } },
      })) as ExtensiveCallsResponse;
      partiesByCall = buildSpeakerMaps(extensive.calls ?? []);
    } catch (err) {
      // Zero parties came back (transient empty result) — fall through with an
      // empty map so the transcript still returns, unattributed. Any other error
      // is real and propagates.
      if (!isNoCallsFound(err)) throw err;
    }
  }

  const callTranscripts = (transcripts.callTranscripts ?? []).map((r) => attributeRecord(r, partiesByCall));
  const anyResolved = callTranscripts.some((c) => Object.keys(c.speakers).length > 0);
  const note =
    callTranscripts.length > 0 && !anyResolved
      ? "Speaker names could not be resolved (participant data was unavailable); transcript lines carry raw speakerId only."
      : undefined;

  return note ? { callTranscripts, note } : { callTranscripts };
}
