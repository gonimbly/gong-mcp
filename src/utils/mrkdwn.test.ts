import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { markdownToMrkdwn } from "./mrkdwn.js";

describe("markdownToMrkdwn", () => {
  test("converts a markdown link to Slack <url|text>", () => {
    assert.equal(markdownToMrkdwn("see [the docs](https://x.io/a)"), "see <https://x.io/a|the docs>");
  });

  test("converts multiple links on one line", () => {
    assert.equal(
      markdownToMrkdwn("[a](https://x/a) and [b](https://x/b)"),
      "<https://x/a|a> and <https://x/b|b>"
    );
  });

  test("converts an image to a plain link (drops the !)", () => {
    assert.equal(markdownToMrkdwn("![alt](https://x/i.png)"), "<https://x/i.png|alt>");
  });

  test("strips heading hashes and bolds the line", () => {
    assert.equal(markdownToMrkdwn("### Bug Fixes"), "*Bug Fixes*");
    assert.equal(markdownToMrkdwn("# Title"), "*Title*");
  });

  test("converts **bold** to *bold*", () => {
    assert.equal(markdownToMrkdwn("a **strong** word"), "a *strong* word");
  });

  test("converts * and - bullets to a bullet char", () => {
    assert.equal(markdownToMrkdwn("* one\n- two"), "• one\n• two");
  });

  test("escapes raw angle brackets so Slack does not mis-parse them", () => {
    assert.equal(markdownToMrkdwn("Go Nimbly <> Acme"), "Go Nimbly &lt;&gt; Acme");
  });

  test("leaves inline code and plain text untouched", () => {
    assert.equal(
      markdownToMrkdwn("set `GONG_DAILY_QUOTA` to 10000"),
      "set `GONG_DAILY_QUOTA` to 10000"
    );
  });

  test("transforms a realistic semantic-release notes block", () => {
    const input = [
      "## [1.1.0](https://github.com/o/r/compare/v1.0.0...v1.1.0) (2026-06-18)",
      "",
      "### Features",
      "",
      "* **discovery:** surface Salesforce IDs ([9cbd98f](https://github.com/o/r/commit/9cbd98f))",
      "",
      "### Bug Fixes",
      "",
      "* **quota:** alarm by 10k ([8cc4d7e](https://github.com/o/r/commit/8cc4d7e))",
    ].join("\n");

    const out = markdownToMrkdwn(input);

    assert.ok(
      out.includes("*<https://github.com/o/r/compare/v1.0.0...v1.1.0|1.1.0> (2026-06-18)*"),
      `header: ${out}`
    );
    assert.ok(out.includes("*Features*"), `features heading: ${out}`);
    assert.ok(
      out.includes("• *discovery:* surface Salesforce IDs (<https://github.com/o/r/commit/9cbd98f|9cbd98f>)"),
      `bullet: ${out}`
    );
    assert.ok(out.includes("*Bug Fixes*"), `bugfix heading: ${out}`);
    assert.ok(!out.includes("**"), `no markdown bold should remain: ${out}`);
    assert.ok(!out.includes("](http"), `no markdown links should remain: ${out}`);
    assert.ok(!/^#/m.test(out), `no leading heading hashes should remain: ${out}`);
  });
});
