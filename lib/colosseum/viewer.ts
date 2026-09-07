import type { GroupRole } from "@/lib/db/schema";
import { groupRolesForUser } from "./group";
import { ownerIdForUser } from "./owner";

// Who is looking, in the terms the queries need: their user id (for
// channel_member rows and block authorship, which are people) and every owner
// they may act as, each with the role they hold there.
//
// Two kinds of id rather than one because the tables genuinely disagree about
// what a viewer is. A person's user id and their owner id are different values,
// so comparing `channel.owned_by` to a session's user id silently denies access
// instead of failing — carrying both is what stops that from being writable.
//
// Lives in its own module because the reads that need it (channels, columns,
// activity) would otherwise have to import it through each other.
export type ViewerScope = {
  userId: string | null;
  // The viewer's own owner row: what a channel they create belongs to, and what
  // "this is my profile" means. Null when signed out or not yet onboarded.
  ownerId: string | null;
  // Every owner the viewer can act for — their own, plus each group they are in
  // — mapped to the role they hold there. Their own owner is always "owner".
  //
  // A map rather than a list because the role decides *what* they may do: any
  // role can contribute to and read that owner's channels, but only owner and
  // admin can manage them.
  roles: Map<string, GroupRole>;
};

export const SIGNED_OUT: ViewerScope = { userId: null, ownerId: null, roles: new Map() };

// Resolve a session's user id into the scope the reads take. Signed-out viewers
// skip both lookups entirely.
export async function viewerScope(userId: string | null): Promise<ViewerScope> {
  if (!userId) return SIGNED_OUT;
  const [ownerId, groupRoles] = await Promise.all([
    ownerIdForUser(userId),
    groupRolesForUser(userId),
  ]);
  const roles = new Map(groupRoles);
  // A person owns themselves, which is what collapses the personal and group
  // cases into one lookup instead of a branch at every call site.
  if (ownerId) roles.set(ownerId, "owner");
  return { userId, ownerId, roles };
}

// The owner ids a viewer may act for, for the `in (...)` the list queries need.
export function viewerOwnerIds(viewer: ViewerScope): string[] {
  return [...viewer.roles.keys()];
}

// The viewer's role in one owner, or null when they hold none.
export function viewerRoleFor(viewer: ViewerScope, ownerId: string): GroupRole | null {
  return viewer.roles.get(ownerId) ?? null;
}
