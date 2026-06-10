import type { GongClient } from "./client.js";

export interface GongIdentity {
  userId: string;
  email: string;
  fullName?: string;
}

interface GongUserRecord {
  id: string;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

interface ListUsersResponse {
  users?: GongUserRecord[];
  records?: { cursor?: string };
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, { identity: GongIdentity; expiresAt: number }>();

/**
 * Resolve a verified work email to the matching Gong user.
 * Paginates /v2/users; results are cached for an hour.
 */
export async function resolveGongIdentity(client: GongClient, email: string): Promise<GongIdentity | null> {
  const key = email.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  let cursor: string | undefined;
  do {
    const page = await client.listUsers(cursor ? { cursor } : {}) as ListUsersResponse;
    for (const user of page.users ?? []) {
      if (user.emailAddress?.toLowerCase() === key) {
        const identity: GongIdentity = {
          userId: String(user.id),
          email: key,
          fullName: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
        };
        cache.set(key, { identity, expiresAt: Date.now() + CACHE_TTL_MS });
        return identity;
      }
    }
    cursor = page.records?.cursor;
  } while (cursor);

  return null;
}
