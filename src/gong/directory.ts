/**
 * Cached Gong user directory for name/email → user resolution.
 *
 * Built on `listUsers`, which is open in every policy mode (directory data
 * only) — never on `getExtensiveUsers`, which is admin-gated. Cached at module
 * level with the same 1h TTL trade-off as src/gong/identity.ts.
 */
import type { GongClient } from "./client.js";
import { scanPages } from "./pagination.js";

export interface DirectoryUser {
  userId: string;
  /** Lowercased. */
  email: string;
  fullName: string;
  title?: string;
  active?: boolean;
  managerId?: string;
}

interface ListUsersPage {
  users?: Array<{
    id?: string | number;
    emailAddress?: string;
    firstName?: string;
    lastName?: string;
    title?: string;
    active?: boolean;
    managerId?: string | number;
  }>;
  records?: { totalRecords?: number; cursor?: string };
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// The directory must be complete — matching against a truncated one would
// silently miss people. 50 pages = 5000 users, far above this org's size.
const MAX_DIRECTORY_PAGES = 50;

let cache: { users: DirectoryUser[]; expiresAt: number } | null = null;

export async function loadUserDirectory(client: GongClient): Promise<DirectoryUser[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.users;

  const { pages, truncated } = await scanPages<ListUsersPage>(
    (cursor) => client.listUsers(cursor ? { cursor } : {}) as Promise<ListUsersPage>,
    MAX_DIRECTORY_PAGES,
  );
  if (truncated) {
    throw new Error(
      `Gong user directory exceeds ${MAX_DIRECTORY_PAGES * 100} users — refusing to match against an incomplete directory.`
    );
  }

  const users: DirectoryUser[] = [];
  for (const page of pages) {
    for (const u of page.users ?? []) {
      if (u.id == null) continue;
      users.push({
        userId: String(u.id),
        email: (u.emailAddress ?? "").toLowerCase(),
        fullName: [u.firstName, u.lastName].filter(Boolean).join(" "),
        title: u.title,
        active: u.active,
        managerId: u.managerId != null ? String(u.managerId) : undefined,
      });
    }
  }

  cache = { users, expiresAt: Date.now() + CACHE_TTL_MS };
  return users;
}

/** Case-insensitive substring match on full name or email. */
export function matchDirectoryUsers(users: DirectoryUser[], query: string): DirectoryUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return users.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.includes(q));
}

export function clearUserDirectoryCache(): void {
  cache = null;
}
