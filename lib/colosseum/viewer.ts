import { ownerIdForUser } from "./owner";

// Who is looking, in the terms the queries need: their user id (for
// channel_member rows and block authorship, which are people) and the owner id
// they act as (for channel ownership, which is not a person). Both null for a
// signed-out viewer.
//
// Two ids rather than one because the tables genuinely disagree about what a
// viewer is. A person's user id and their owner id are different values, so
// comparing `channel.owned_by` to a session's user id silently denies access
// instead of failing — carrying both is what stops that from being writable.
//
// Lives in its own module because the reads that need it (channels, columns,
// activity) would otherwise have to import it through each other.
export type ViewerScope = {
  userId: string | null;
  ownerId: string | null;
};

export const SIGNED_OUT: ViewerScope = { userId: null, ownerId: null };

// Resolve a session's user id into the scope the reads take. Signed-out viewers
// skip the lookup entirely.
export async function viewerScope(userId: string | null): Promise<ViewerScope> {
  if (!userId) return SIGNED_OUT;
  return { userId, ownerId: await ownerIdForUser(userId) };
}
