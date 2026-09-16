import { cache } from "react";

import { and, eq, ilike, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { owner, userProfile, type EmailNotificationPrefs } from "@/lib/db/schema";
import { sanitizeSearch, SEARCH_LIMIT } from "@/lib/utils";

// A person's profile, assembled from the two tables it now spans: the `owner`
// row carries the handle, avatar and bio (the things that have to share one
// namespace with groups, see ./owner), and `user_profile` carries the email
// notification settings, which belong to a human being and never to a group.
//
// Every read here filters to `kind = "user"`, so a group's handle never comes
// back as a person. Callers that mean an owner of either kind use ./owner.

// Re-exported for server-side callers; client components import these directly
// from ./handle to avoid pulling the server-only db client into their bundle.
export { HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH, normalizeHandle, validateHandle } from "./handle";

export type UserProfile = {
  user_id: string;
  // The owner row this person's channels hang off. Distinct from user_id: it is
  // what `channel.owned_by` holds, and comparing the two is always a bug.
  owner_id: string;
  created_at: string;
  handle: string;
  avatar_url?: string;
  about?: string;
  email_notifications: EmailNotificationPrefs;
};

// A profile search hit. Profiles are public, so no viewer scoping is needed.
export type ProfileSearchResult = { handle: string; avatar_url?: string; about?: string };

// Profiles whose handle or about text matches `query`. Used by the nav search
// box, so capped to a handful of results. Returns [] for an empty query.
export async function searchProfiles(
  query: string,
  limit = SEARCH_LIMIT,
): Promise<ProfileSearchResult[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }
  const pattern = `%${term}%`;
  const rows = await db
    .select({
      handle: owner.handle,
      avatar_url: owner.avatar_url,
      about: owner.about,
    })
    .from(owner)
    .where(
      and(eq(owner.kind, "user"), or(ilike(owner.handle, pattern), ilike(owner.about, pattern))),
    )
    .limit(limit);
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

type ProfileRow = {
  owner: typeof owner.$inferSelect;
  profile: typeof userProfile.$inferSelect;
};
function toProfile({ owner: o, profile }: ProfileRow): UserProfile {
  return {
    user_id: profile.user_id,
    owner_id: o.id,
    created_at: o.created_at.toISOString(),
    handle: o.handle,
    avatar_url: o.avatar_url ?? undefined,
    about: o.about ?? undefined,
    email_notifications: profile.email_notifications,
  };
}

// The two rows are written together at onboarding and cascade together from
// `user`, so an inner join is right: half a profile is not a state the app can
// produce, and a null result still means "no profile yet", as it did before.
function profileSelect() {
  return db
    .select({ owner, profile: userProfile })
    .from(owner)
    .innerJoin(userProfile, eq(userProfile.user_id, owner.user_id))
    .$dynamic();
}

// Wrapped in React cache() so the profile page and its metadata share one
// lookup per request. cache() keys on the handle.
export const getPublicUserProfile = cache(async (handle: string): Promise<UserProfile | null> => {
  const [row] = await profileSelect()
    .where(and(eq(owner.handle, handle), eq(owner.kind, "user")))
    .limit(1);
  return row ? toProfile(row) : null;
});

// Returns the profile for a user, or null when they haven't created one yet
// (e.g. immediately after sign-up, before onboarding). Callers should treat a
// null result as "send the user to onboarding" rather than an error.
export const getUserProfile = cache(async (user_id: string): Promise<UserProfile | null> => {
  const [row] = await profileSelect().where(eq(userProfile.user_id, user_id)).limit(1);
  return row ? toProfile(row) : null;
});

export async function updateUserProfile(
  user_id: string,
  updates: {
    handle?: string;
    about?: string;
    avatar_url?: string;
    email_notifications?: EmailNotificationPrefs;
  },
): Promise<UserProfile> {
  const { email_notifications, ...ownerUpdates } = updates;
  try {
    await db.transaction(async (tx) => {
      if (Object.keys(ownerUpdates).length > 0) {
        await tx.update(owner).set(ownerUpdates).where(eq(owner.user_id, user_id));
      }
      if (email_notifications !== undefined) {
        await tx
          .update(userProfile)
          .set({ email_notifications })
          .where(eq(userProfile.user_id, user_id));
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HandleTakenError(updates.handle ?? "");
    }
    throw error;
  }
  // Read back through the same join the rest of the module uses so the caller
  // gets one shape. Not via getUserProfile: that is React-cached per request and
  // would hand back the pre-update row to anything that already read it.
  const [row] = await profileSelect().where(eq(userProfile.user_id, user_id)).limit(1);
  if (!row) {
    throw new Error("Profile not found.");
  }
  return toProfile(row);
}

// Creates the owner row and the user_profile row for a freshly signed-up user,
// in one transaction — a person with a handle but no settings row (or the other
// way round) is not a state anything else here knows how to read. Throws
// HandleTakenError when the chosen handle is already in use.
export async function createUserProfile(user_id: string, handle: string): Promise<UserProfile> {
  try {
    return await db.transaction(async (tx) => {
      const [ownerRow] = await tx
        .insert(owner)
        .values({ kind: "user", handle, user_id })
        .returning();
      const [profileRow] = await tx.insert(userProfile).values({ user_id }).returning();
      return toProfile({ owner: ownerRow, profile: profileRow });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HandleTakenError(handle);
    }
    throw error;
  }
}
