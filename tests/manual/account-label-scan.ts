/**
 * Live diagnostic — tally CRM Account labels (and external email domains) across
 * a date range, windowed to stay under the discovery 1000-call scan cap, so we
 * can see whether an account (e.g. "BillingPlatform") appears at all, under what
 * exact label, and over what window. Read-only.
 *
 * Run: npx tsx tests/manual/account-label-scan.ts [needle] [lookbackDays]
 *      npx tsx tests/manual/account-label-scan.ts bill 120
 */
import { GongClient } from "../../src/gong/client.js";
import { scanPages } from "../../src/gong/pagination.js";

const NEEDLE = (process.argv[2] ?? "bill").toLowerCase();
const LOOKBACK_DAYS = Number(process.argv[3] ?? 120);
const WINDOW_DAYS = 7;
const DAY = 86400_000;

interface Party { emailAddress?: string; affiliation?: string }
interface Field { name?: string; value?: unknown }
interface Obj { objectType?: string; fields?: Field[] }
interface Ctx { objects?: Obj[] }
interface Call { metaData?: { id?: string; started?: string; title?: string }; parties?: Party[]; context?: Ctx[] }
interface Page { calls?: Call[]; records?: { totalRecords?: number; cursor?: string } }

function accountNames(call: Call): string[] {
  const out: string[] = [];
  for (const ctx of call.context ?? [])
    for (const obj of ctx.objects ?? [])
      if (obj.objectType === "Account")
        for (const f of obj.fields ?? [])
          if (f.name === "Name" && typeof f.value === "string") out.push(f.value);
  return out;
}

async function main() {
  const raw = new GongClient();
  const now = Date.now();
  const acctCounts = new Map<string, number>();
  const needleHits: Array<{ started?: string; title?: string; label: string; how: string }> = [];
  let totalCalls = 0, scanned = 0, anyTruncated = false;

  for (let d = 0; d < LOOKBACK_DAYS; d += WINDOW_DAYS) {
    const to = new Date(now - d * DAY).toISOString();
    const from = new Date(now - Math.min(d + WINDOW_DAYS, LOOKBACK_DAYS) * DAY).toISOString();
    let res;
    try {
      res = await scanPages<Page>(
        (cursor) => raw.getExtensiveCalls({
          filter: { fromDateTime: from, toDateTime: to },
          contentSelector: { exposedFields: { parties: true }, context: "Extended" },
          ...(cursor ? { cursor } : {}),
        }) as Promise<Page>,
        10,
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (/No calls found/i.test(msg)) continue;
      throw e;
    }
    if (res.truncated) anyTruncated = true;
    totalCalls += res.totalRecords ?? 0;
    for (const page of res.pages) {
      for (const call of page.calls ?? []) {
        scanned++;
        const labels = accountNames(call);
        for (const label of labels) acctCounts.set(label, (acctCounts.get(label) ?? 0) + 1);
        // needle: CRM label, title, or external email domain
        for (const label of labels)
          if (label.toLowerCase().includes(NEEDLE))
            needleHits.push({ started: call.metaData?.started, title: call.metaData?.title, label, how: "crm" });
        if (call.metaData?.title?.toLowerCase().includes(NEEDLE))
          needleHits.push({ started: call.metaData?.started, title: call.metaData?.title, label: "(title)", how: "title" });
        for (const p of call.parties ?? []) {
          if (p.affiliation === "Internal") continue;
          const dom = p.emailAddress?.toLowerCase().split("@")[1];
          if (dom?.includes(NEEDLE))
            needleHits.push({ started: call.metaData?.started, title: call.metaData?.title, label: dom, how: "domain" });
        }
      }
    }
  }

  console.log(`Scanned ${scanned} calls over ~${LOOKBACK_DAYS}d (windowed ${WINDOW_DAYS}d). truncatedWindows=${anyTruncated}`);
  console.log(`Distinct CRM Account labels: ${acctCounts.size}\n`);

  console.log(`── Labels containing "${NEEDLE}" ──`);
  const matchLabels = [...acctCounts].filter(([l]) => l.toLowerCase().includes(NEEDLE)).sort((a, b) => b[1] - a[1]);
  if (matchLabels.length === 0) console.log("  (none)");
  for (const [l, n] of matchLabels) console.log(`  ${n.toString().padStart(4)}  ${l}`);

  console.log(`\n── All needle hits (crm/title/domain), newest first (cap 25) ──`);
  needleHits.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
  if (needleHits.length === 0) console.log("  (none)");
  for (const h of needleHits.slice(0, 25))
    console.log(`  ${h.started?.slice(0, 10)}  [${h.how}] ${h.label}  — "${h.title}"`);

  console.log(`\n── Top 25 accounts by call volume (sanity) ──`);
  for (const [l, n] of [...acctCounts].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${n.toString().padStart(4)}  ${l}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
