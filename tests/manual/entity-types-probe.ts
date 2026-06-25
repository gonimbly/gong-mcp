/**
 * Live probe — which crmEntityType values do Gong's AI entity endpoints accept?
 * Manual, read-only, never runs in CI.
 *
 * gong_generate_brief advertises ACCOUNT | DEAL | CONTACT | LEAD and the ask
 * tools use ACCOUNT/DEAL. This confirms — against the real org — whether the
 * endpoints actually accept CONTACT/LEAD or reject them, so we don't ship a tool
 * path that always errors. Uses a deliberately nonexistent CRM id: a "type not
 * supported" style error means the type is rejected; an "entity/brief not found"
 * error means the type was accepted (the id just doesn't exist).
 *
 * Requires the org's Gen-AI-Beta + MCP-Server-Beta flags (same as the tools);
 * if they're off, every call fails uniformly — itself a useful signal.
 *
 * Credentials: GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET / GONG_BASE_URL.
 * Run:  npm run probe:entity-types -- "<Published Brief Name>"
 */
import { GongClient, GongApiError } from "../../src/gong/client.js";
import { aiEntitiesEnabled } from "../../src/utils/featureFlags.js";

const briefName = process.argv[2] ?? "__no_such_brief__";
const DUMMY_ID = "__probe_nonexistent_id__";
const TYPES = ["ACCOUNT", "DEAL", "CONTACT", "LEAD"] as const;

async function report(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`  ${label.padEnd(8)} → 200 OK (accepted + returned data)`);
  } catch (err) {
    if (err instanceof GongApiError) {
      const body = err.message.replace(/\s+/g, " ").slice(0, 220);
      console.log(`  ${label.padEnd(8)} → HTTP ${err.status} — ${body}`);
    } else {
      console.log(`  ${label.padEnd(8)} → ERROR ${(err as Error).message}`);
    }
  }
}

async function main() {
  // These endpoints consume paid Gong credits and are disabled by default; the
  // GongClient request guard would throw on every call below. Opt in to probe.
  if (!aiEntitiesEnabled()) {
    console.log(
      "Skipped: Gong AI entity endpoints are disabled (they consume paid credits).\n" +
      "Re-run with the flag set to probe them, e.g.:\n" +
      '  GONG_ENABLE_AI_ENTITIES=true npm run probe:entity-types -- "<Published Brief Name>"'
    );
    return;
  }

  const client = new GongClient();
  const ws = (await client.listWorkspaces()) as { workspaces?: Array<{ id?: string | number }> };
  const workspaceId = String(ws.workspaces?.[0]?.id ?? "");
  console.log(`workspaceId=${workspaceId}  briefName=${JSON.stringify(briefName)}\n`);

  const c = client as unknown as {
    request: (path: string) => Promise<unknown>;
    qs: (p: Record<string, string>) => string;
  };

  console.log("ask-entity  (gong_ask_account / gong_ask_deal):");
  for (const crmEntityType of TYPES) {
    await report(crmEntityType, () =>
      c.request(
        `/v2/entities/ask-entity${c.qs({
          workspaceId,
          crmEntityType,
          crmEntityId: DUMMY_ID,
          timePeriod: "THIS_MONTH",
          question: "probe",
        })}`
      )
    );
  }

  console.log("\nget-brief   (gong_generate_brief):");
  for (const crmEntityType of TYPES) {
    await report(crmEntityType, () =>
      client.generateBrief({ workspaceId, briefName, crmEntityType, crmEntityId: DUMMY_ID, timePeriod: "THIS_MONTH" })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
