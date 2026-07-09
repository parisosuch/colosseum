import { cache } from "react";

import { eq, ilike, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { userProfile } from "@/lib/db/schema";
import { sanitizeSearch } from "@/lib/utils";

// Re-exported for server-side callers; client components import these directly
// from ./handle to avoid pulling the server-only db client into their bundle.
export { HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH, normalizeHandle, validateHandle } from "./handle";

export type UserProfile = {
  user_id: string;
  created_at: string;
  handle: string;
  avatar_url?: string;
  about?: string;
};

// A profile search hit. Profiles are public, so no viewer scoping is needed.
export type ProfileSearchResult = { handle: string; avatar_url?: string; about?: string };

// Profiles whose handle or about text matches `query`. Used by the nav search
// box, so capped to a handful of results. Returns [] for an empty query.
export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }
  const pattern = `%${term}%`;
  const rows = await db
    .select({
      handle: userProfile.handle,
      avatar_url: userProfile.avatar_url,
      about: userProfile.about,
    })
    .from(userProfile)
    .where(or(ilike(userProfile.handle, pattern), ilike(userProfile.about, pattern)))
    .limit(10);
  return rows.map((r) => ({
    handle: r.handle,
    avatar_url: r.avatar_url ?? undefined,
    about: r.about ?? undefined,
  }));
}

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`The handle "${handle}" is already taken.`);
    this.name = "HandleTakenError";
  }
}

// Postgres unique_violation (code 23505). Drizzle wraps the driver error in a
// DrizzleQueryError, so the code can sit on the error itself or on its `cause`.
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined;
  const cause =
    typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return code(error) === "23505" || code(cause) === "23505";
}

type UserProfileRow = typeof userProfile.$inferSelect;
function toProfile(row: UserProfileRow): UserProfile {
  return {
    user_id: row.user_id,
    created_at: row.created_at.toISOString(),
    handle: row.handle,
    avatar_url: row.avatar_url ?? undefined,
    about: row.about ?? undefined,
  };
}

// Wrapped in React cache() so the profile page and its metadata share one
// lookup per request. cache() keys on the handle.
export const getPublicUserProfile = cache(async (handle: string): Promise<UserProfile | null> => {
  const [row] = await db.select().from(userProfile).where(eq(userProfile.handle, handle)).limit(1);
  return row ? toProfile(row) : null;
});

// Returns the profile for a user, or null when they haven't created one yet
// (e.g. immediately after sign-up, before onboarding). Callers should treat a
// null result as "send the user to onboarding" rather than an error.
export const getUserProfile = cache(async (user_id: string): Promise<UserProfile | null> => {
  const [row] = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.user_id, user_id))
    .limit(1);
  return row ? toProfile(row) : null;
});

export async function updateUserProfile(
  user_id: string,
  updates: { handle?: string; about?: string; avatar_url?: string },
): Promise<UserProfile> {
  try {
    const [row] = await db
      .update(userProfile)
      .set(updates)
      .where(eq(userProfile.user_id, user_id))
      .returning();
    if (!row) {
      throw new Error("Profile not found.");
    }
    return toProfile(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HandleTakenError(updates.handle ?? "");
    }
    throw error;
  }
}

// Creates the user_profile row for a freshly signed-up user. Throws
// HandleTakenError when the chosen handle is already in use.
export async function createUserProfile(user_id: string, handle: string): Promise<UserProfile> {
  try {
    const [row] = await db.insert(userProfile).values({ user_id, handle }).returning();
    return toProfile(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HandleTakenError(handle);
    }
    throw error;
  }
}
