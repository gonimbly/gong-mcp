/** Runtime feature flags for the Gong MCP server. */

/**
 * Gong's AI "entity" endpoints — `/v2/entities/ask-entity` (account/deal Q&A)
 * and `/v2/entities/get-brief` (structured brief) — consume **paid Gong AI
 * credits** on every call. The Gong team asked us not to route to them, so the
 * three tools that use them (`gong_ask_account`, `gong_ask_deal`,
 * `gong_generate_brief`) are **disabled unless explicitly opted in** via
 * `GONG_ENABLE_AI_ENTITIES=true`.
 *
 * Read live (not cached at import): the request-layer credit guard re-checks it on
 * every call, so flipping the env var takes effect immediately for blocking. Tool
 * *visibility* in `tools/list`, however, is decided once when `registerEntityTools`
 * runs, so changing the flag only changes which tools are advertised after a
 * re-registration (process restart, or a new gateway session).
 */
export function aiEntitiesEnabled(): boolean {
  return process.env.GONG_ENABLE_AI_ENTITIES === "true";
}
