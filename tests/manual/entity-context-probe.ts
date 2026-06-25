/**
 * Live probe — credit-free gong_entity_context against the REAL Gong API.
 * Manual, read-only, never runs in CI. Spends NO Gong AI credits (it only reads
 * /v2/calls/extensive + /v2/calls/transcript).
 *
 * Pass the CRM ids/email to aggregate. ACCOUNT/DEAL take a Salesforce
 * Account/Opportunity id (find one in the `crmRefs` of gong_find_calls /
 * gong_call_summary); CONTACT/LEAD takes the person's email.
 *
 * Credentials: GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET / GONG_BASE_URL.
 * Run:  npm run probe:entity-context -- <accountId> [opportunityId] [contactEmail]
 */
import { GongClient } from "../../src/gong/client.js";
import { aggregateEntityContext, type EntityType } from "../../src/gong/entityContext.js";

const [accountId, dealId, contactEmail] = process.argv.slice(2);

async function run(crmEntityType: EntityType, entityRef?: string) {
  if (!entityRef) {
    console.log(`\n${crmEntityType}: (skipped — no ref provided)`);
    return;
  }
  console.log(`\n${crmEntityType}  ref=${entityRef}`);
  try {
    const res = await aggregateEntityContext(new GongClient(), { crmEntityType, entityRef });
    console.log(`  calls=${res.calls.length}  scanned=${res.coverage.scannedCalls}  matched=${res.coverage.matchedCalls}`);
    for (const c of res.calls.slice(0, 3)) {
      console.log(`   • ${c.started?.slice(0, 10)}  ${c.title ?? "(untitled)"} — ${c.brief?.slice(0, 80) ?? "(no brief)"}`);
    }
    if (res.note) console.log(`  note: ${res.note}`);
  } catch (err) {
    console.log(`  ERROR ${(err as Error).message}`);
  }
}

async function main() {
  if (!accountId && !dealId && !contactEmail) {
    console.log("Usage: npm run probe:entity-context -- <accountId> [opportunityId] [contactEmail]");
    return;
  }
  await run("ACCOUNT", accountId);
  await run("DEAL", dealId);
  await run("CONTACT", contactEmail);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
