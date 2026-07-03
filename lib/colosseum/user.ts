import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { userProfile } from "@/lib/db/schema";

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

export async function getPublicUserProfile(handle: string): Promise<UserProfile | null> {
  const [row] = await db.select().from(userProfile).where(eq(userProfile.handle, handle)).limit(1);
  return row ? toProfile(row) : null;
}

// Returns the profile for a user, or null when they haven't created one yet
// (e.g. immediately after sign-up, before onboarding). Callers should treat a
// null result as "send the user to onboarding" rather than an error.
export async function getUserProfile(user_id: string): Promise<UserProfile | null> {
  const [row] = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.user_id, user_id))
    .limit(1);
  return row ? toProfile(row) : null;
}

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
