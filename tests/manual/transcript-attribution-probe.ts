/**
 * Live de-risk for speaker attribution — manual, against the REAL Gong API.
 * Never runs in CI. STRICTLY READ-ONLY.
 *
 * The fix in src/gong/transcripts.ts hinges on a single contract: each party in
 * /v2/calls/extensive (parties exposed) carries a `speakerId` that matches the
 * `speakerId` on /v2/calls/transcript monologues. This probe confirms that on a
 * real call, then runs attributeTranscripts() end-to-end and prints the result.
 *
 * Default call is the one from the bug report (GN<>Delinea, 6 participants incl.
 * 3 external). Override with an arg:  npm run probe:transcript-attribution -- <callId>
 *
 * Run:  npm run probe:transcript-attribution
 */
import { GongClient } from "../../src/gong/client.js";
import { attributeTranscripts } from "../../src/gong/transcripts.js";

const CALL_ID = process.argv[2] ?? "8786005642231829186";
const raw = new GongClient();

const ids = (xs: Array<string | number | undefined>) => [...new Set(xs.filter((x) => x != null).map(String))];

const transcript = (await raw.getCallTranscripts([CALL_ID])) as {
  callTranscripts?: Array<{ callId?: string; transcript?: Array<{ speakerId?: string | number }> }>;
};
const extensive = (await raw.getExtensiveCalls({
  filter: { callIds: [CALL_ID] },
  contentSelector: { exposedFields: { parties: true } },
})) as { calls?: Array<{ parties?: Array<{ speakerId?: string | number; name?: string; affiliation?: string }> }> };

const transcriptSpeakerIds = ids((transcript.callTranscripts?.[0]?.transcript ?? []).map((m) => m.speakerId));
const parties = extensive.calls?.[0]?.parties ?? [];
const partySpeakerIds = ids(parties.map((p) => p.speakerId));
const overlap = transcriptSpeakerIds.filter((id) => partySpeakerIds.includes(id));

console.log(`\nCall ${CALL_ID}`);
console.log(`  transcript speakerIds (${transcriptSpeakerIds.length}): ${transcriptSpeakerIds.join(", ") || "—"}`);
console.log(`  party speakerIds      (${partySpeakerIds.length}): ${partySpeakerIds.join(", ") || "—"}`);
console.log(`  parties with speakerId: ${parties.filter((p) => p.speakerId != null).map((p) => `${p.name} [${p.affiliation}]`).join(", ") || "—"}`);
console.log(`  externals present: ${parties.some((p) => p.affiliation === "External") ? "yes" : "NO"}`);

const allJoin = transcriptSpeakerIds.length > 0 && overlap.length === transcriptSpeakerIds.length;
console.log(
  `\n  JOIN VERDICT: ${allJoin ? "✅ every transcript speakerId resolves to a party" : "❌ unmatched: " + transcriptSpeakerIds.filter((id) => !partySpeakerIds.includes(id)).join(", ")}`,
);

const attributed = await attributeTranscripts(raw, [CALL_ID]);
const call = attributed.callTranscripts[0];
console.log(`\n  attributeTranscripts() → ${Object.keys(call?.speakers ?? {}).length} speakers resolved` + (attributed.note ? ` (note: ${attributed.note})` : ""));
for (const line of (call?.transcript ?? []).slice(0, 5)) {
  console.log(`    ${line.speaker?.name ?? "??? (" + line.speakerId + ")"} [${line.speaker?.affiliation ?? "?"}]: ${(line as any).sentences?.[0]?.text ?? ""}`.slice(0, 120));
}

process.exit(allJoin ? 0 : 1);
