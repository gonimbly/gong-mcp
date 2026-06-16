/**
 * Build identity surfaced to operators so a deploy can be confirmed end-to-end.
 *
 * `SERVER_VERSION` is the MCP serverInfo version — bump it per release. The
 * commit comes from RENDER_GIT_COMMIT, which Render injects (full SHA) at build
 * and runtime; it's undefined for local/stdio runs, where the label reads "dev".
 */
export const SERVER_VERSION = "0.6.0";

/**
 * Format a human-readable build id, e.g. `v0.6.0 (8419e3d)`.
 * @param rawCommit RENDER_GIT_COMMIT (full SHA) in prod; undefined/empty locally.
 * @param version   server version (defaults to SERVER_VERSION).
 */
export function buildLabel(rawCommit?: string, version: string = SERVER_VERSION): string {
  const commit = rawCommit?.trim() ? rawCommit.trim().slice(0, 7) : "dev";
  return `v${version} (${commit})`;
}
