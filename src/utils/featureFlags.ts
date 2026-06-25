/** Runtime feature flags for the Gong MCP server. */

/**
 * Gong's AI "entity" endpoints — `/v2/entities/ask-entity` (account/deal Q&A)
 * and `/v2/entities/get-brief` (structured brief) — consume **paid Gong AI
 * credits** on every call. The Gong team asked us not to route to them, so the
 * three tools that use them (`gong_ask_account`, `gong_ask_deal`,
 * `gong_generate_brief`) are **disabled unless explicitly opted in** via
 * `GONG_ENABLE_AI_ENTITIES=true`.
 *
 * Read live (not cached at import) so tests and redeploys can toggle it without
 * a process restart.
 */
export function aiEntitiesEnabled(): boolean {
  return process.env.GONG_ENABLE_AI_ENTITIES === "true";
}
