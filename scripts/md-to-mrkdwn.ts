/**
 * Tiny CLI: read Markdown on stdin, write Slack mrkdwn on stdout.
 * Used by the release job in .github/workflows/ci.yml to format release notes
 * before posting them to the Slack alerts webhook:
 *
 *   gh release view "$tag" --json body --jq .body | npx tsx scripts/md-to-mrkdwn.ts
 */
import { markdownToMrkdwn } from "../src/utils/mrkdwn.js";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  process.stdout.write(markdownToMrkdwn(input));
});
