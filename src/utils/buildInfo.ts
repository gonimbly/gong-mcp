/**
 * Build identity surfaced to operators so a deploy can be confirmed end-to-end.
 *
 * `SERVER_VERSION` is read from package.json at runtime so semantic-release's
 * automatic version bump is reflected without any manual edits to this file.
 * The commit comes from RENDER_GIT_COMMIT, which Render injects (full SHA) at
 * build and runtime; it's undefined for local/stdio runs, where the label reads "dev".
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const _dir = dirname(fileURLToPath(import.meta.url));
// Works in tsx (src/utils/) and compiled (dist/utils/) — package.json is two levels up
const _pkg = JSON.parse(readFileSync(join(_dir, "../../package.json"), "utf8")) as { version: string };
export const SERVER_VERSION: string = _pkg.version;

/**
 * Format a human-readable build id, e.g. `v0.7.0 (8419e3d)`.
 * @param rawCommit RENDER_GIT_COMMIT (full SHA) in prod; undefined/empty locally.
 * @param version   server version (defaults to SERVER_VERSION).
 */
export function buildLabel(rawCommit?: string, version: string = SERVER_VERSION): string {
  const commit = rawCommit?.trim() ? rawCommit.trim().slice(0, 7) : "dev";
  return `v${version} (${commit})`;
}
