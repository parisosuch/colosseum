import { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type UserProfile = {
  user_id: string;
  created_at: string;
  handle: string;
  avatar_url?: string;
  about?: string;
};

// Handles appear in URLs (/{handle}) and must be unique, so keep them to a
// predictable shape: lowercase letters, numbers, underscores and hyphens.
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
const HANDLE_PATTERN = /^[a-z0-9_-]+$/;

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`The handle "${handle}" is already taken.`);
    this.name = "HandleTakenError";
  }
}

// Normalize user input into a candidate handle (does not guarantee validity).
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

// Returns null when the handle is valid, otherwise a human-readable reason.
export function validateHandle(handle: string): string | null {
  if (handle.length < HANDLE_MIN_LENGTH) {
    return `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`;
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return `Handle must be at most ${HANDLE_MAX_LENGTH} characters.`;
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handle can only contain lowercase letters, numbers, hyphens, and underscores.";
  }
  return null;
}

export async function getPublicUserProfile(
  client: SupabaseClient,
  handle: string,
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from("user_profile")
    .select("*")
    .eq("handle", handle)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Returns the profile for a user, or null when they haven't created one yet
// (e.g. immediately after sign-up, before onboarding). Callers should treat a
// null result as "send the user to onboarding" rather than an error.
export async function getUserProfile(
  client: SupabaseClient,
  user_id: string,
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from("user_profile")
    .select("*")
    .eq("user_id", user_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Creates the user_profile row for a freshly signed-up user. Throws
// HandleTakenError when the chosen handle is already in use.
export async function createUserProfile(
  client: SupabaseClient,
  user_id: string,
  handle: string,
): Promise<UserProfile> {
  const { data, error } = await client
    .from("user_profile")
    .insert({ user_id, handle })
    .select("*")
    .single();

  if (error) {
    // 23505 = unique_violation (handle already taken).
    if ((error as PostgrestError).code === "23505") {
      throw new HandleTakenError(handle);
    }
    throw new Error(error.message);
  }

  return data;
}
