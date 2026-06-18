/**
 * Convert the small subset of Markdown that semantic-release release notes use
 * into Slack "mrkdwn", so notes render in an incoming-webhook message:
 *
 *   [text](url) / ![alt](url) → <url|text>
 *   **bold**                  → *bold*
 *   #, ##, ### …              → *text*   (hashes stripped, line bolded)
 *   leading * / -             → •
 *   raw < >                   → &lt; &gt;  (so Slack doesn't read them as link/mention markup)
 *
 * Inline `code` and plain text are left as-is. URLs are assumed not to contain
 * spaces, ')', or '>' (true for GitHub compare/commit links); '&' is left alone
 * so query-string URLs aren't mangled and bare ampersands still render fine.
 */
export function markdownToMrkdwn(md: string): string {
  return md
    // Escape Slack control chars in the source BEFORE we introduce real <url|…> markup.
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Images, then links → Slack link syntax.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "<$2|$1>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<$2|$1>")
    // Bold: **x** → *x*
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    // Headings: strip leading #'s and bold the line.
    .replace(/^#{1,6}[ \t]+(.*)$/gm, "*$1*")
    // Bullets: leading * or - → •
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    // Collapse runs of blank lines.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
