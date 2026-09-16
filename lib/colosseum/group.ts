import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { group, groupMember, owner, userProfile, type GroupRole } from "@/lib/db/schema";
import { normalizeHandle, validateHandle } from "./handle";
import { HandleTakenError } from "./user";

// Groups: a handle several people share, and the roles that say what each of
// them may do with the channels it owns.
//
// A group is an `owner` row of kind "group" plus a `group` row keyed by it, so
// `group_member.group_id` and `channel.owned_by` hold the same value and the
// visibility queries need no join between them.

export type { GroupRole };

export type Group = {
  // Also the owner id its channels hang off — the two are the same value.
  id: string;
  handle: string;
  name: string;
  about?: string;
  avatar_url?: string;
  created_at: string;
};

export type GroupMember = {
  user_id: string;
  handle: string;
  avatar_url?: string;
  role: GroupRole;
  created_at: string;
};

// Roles that may manage the group's channels and its roster. `member` is the
// contribute-only tier, so it is the one role absent here.
const MANAGING_ROLES: readonly GroupRole[] = ["owner", "admin"];

export function roleCanManage(role: GroupRole | null): boolean {
  return !!role && MANAGING_ROLES.includes(role);
}

function toGroup(o: typeof owner.$inferSelect, g: typeof group.$inferSelect): Group {
  return {
    id: o.id,
    handle: o.handle,
    name: g.name,
    about: o.about ?? undefined,
    avatar_url: o.avatar_url ?? undefined,
    created_at: g.created_at.toISOString(),
  };
}

function groupSelect() {
  return db
    .select({ owner, group })
    .from(group)
    .innerJoin(owner, eq(owner.id, group.owner_id))
    .$dynamic();
}

export async function getGroup(id: string): Promise<Group | null> {
  const [row] = await groupSelect().where(eq(group.owner_id, id)).limit(1);
  return row ? toGroup(row.owner, row.group) : null;
}

export async function getGroupByHandle(handle: string): Promise<Group | null> {
  const [row] = await groupSelect().where(eq(owner.handle, handle)).limit(1);
  return row ? toGroup(row.owner, row.group) : null;
}

// Creates the group and makes its creator the owner, in one transaction — a
// group with no owner is a group nobody can administer, and the partial unique
// index only stops a second one, never a zero.
//
// Throws HandleTakenError when the handle is in use, by a person or a group
// alike: they share one namespace, which is the point of the owner table.
export async function createGroup(input: {
  handle: string;
  name: string;
  created_by: string;
}): Promise<Group> {
  const handle = normalizeHandle(input.handle);
  const invalid = validateHandle(handle);
  if (invalid) {
    throw new Error(invalid);
  }
  const name = input.name.trim();
  if (!name) {
    throw new Error("Enter a name for the group.");
  }
  try {
    return await db.transaction(async (tx) => {
      const [ownerRow] = await tx.insert(owner).values({ kind: "group", handle }).returning();
      const [groupRow] = await tx
        .insert(group)
        .values({ owner_id: ownerRow.id, name, created_by: input.created_by })
        .returning();
      await tx
        .insert(groupMember)
        .values({ group_id: ownerRow.id, user_id: input.created_by, role: "owner" });
      return toGroup(ownerRow, groupRow);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HandleTakenError(handle);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined;
  const cause =
    typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return code(error) === "23505" || code(cause) === "23505";
}

// The viewer's role in one group, or null when they are not in it.
export async function groupRole(group_id: string, user_id: string): Promise<GroupRole | null> {
  const [row] = await db
    .select({ role: groupMember.role })
    .from(groupMember)
    .where(and(eq(groupMember.group_id, group_id), eq(groupMember.user_id, user_id)))
    .limit(1);
  return row?.role ?? null;
}

// Every group the user belongs to, as owner-id → role. This is what a viewer
// scope is built from, so it runs on authorized reads and stays one query.
export async function groupRolesForUser(user_id: string): Promise<Map<string, GroupRole>> {
  const rows = await db
    .select({ group_id: groupMember.group_id, role: groupMember.role })
    .from(groupMember)
    .where(eq(groupMember.user_id, user_id));
  return new Map(rows.map((r) => [r.group_id, r.role]));
}

// The groups a user belongs to, for their profile and the channel-owner picker.
export async function listUserGroups(user_id: string): Promise<(Group & { role: GroupRole })[]> {
  const rows = await db
    .select({ owner, group, role: groupMember.role })
    .from(groupMember)
    .innerJoin(group, eq(group.owner_id, groupMember.group_id))
    .innerJoin(owner, eq(owner.id, group.owner_id))
    .where(eq(groupMember.user_id, user_id))
    .orderBy(asc(owner.handle));
  return rows.map((r) => ({ ...toGroup(r.owner, r.group), role: r.role }));
}

// The roster, owners first then admins then members, each group oldest first.
export async function listGroupMembers(group_id: string): Promise<GroupMember[]> {
  const rows = await db
    .select({
      user_id: groupMember.user_id,
      role: groupMember.role,
      created_at: groupMember.created_at,
      handle: owner.handle,
      avatar_url: owner.avatar_url,
    })
    .from(groupMember)
    .innerJoin(owner, eq(owner.user_id, groupMember.user_id))
    .where(eq(groupMember.group_id, group_id))
    .orderBy(
      sql`case ${groupMember.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
      asc(groupMember.created_at),
    );
  return rows.map((r) => ({
    user_id: r.user_id,
    handle: r.handle,
    avatar_url: r.avatar_url ?? undefined,
    role: r.role,
    created_at: r.created_at.toISOString(),
  }));
}

// The users to notify about something addressed to the group. Its managers
// rather than everyone: a notification is a thing someone has to act on, and a
// twenty-person group should not all get the same one.
export async function groupRecipients(group_id: string): Promise<string[]> {
  const rows = await db
    .select({ user_id: groupMember.user_id })
    .from(groupMember)
    .where(and(eq(groupMember.group_id, group_id), inManagingRoles()))
    .orderBy(asc(groupMember.created_at));
  return rows.map((r) => r.user_id);
}

function inManagingRoles() {
  return sql`${groupMember.role} in ('owner', 'admin')`;
}

// Add someone by handle, defaulting to the contribute-only tier. Idempotent on
// the membership itself: re-adding an existing member leaves their current role
// alone rather than silently demoting them to `member`.
//
// Callers authorize first (this connection bypasses RLS).
export async function addGroupMemberByHandle(
  group_id: string,
  handle: string,
  role: GroupRole = "member",
): Promise<GroupMember> {
  if (role === "owner") {
    throw new Error("Transfer ownership instead of adding a second owner.");
  }
  const normalized = normalizeHandle(handle);
  const [person] = await db
    .select({ user_id: userProfile.user_id, handle: owner.handle, avatar_url: owner.avatar_url })
    .from(owner)
    .innerJoin(userProfile, eq(userProfile.user_id, owner.user_id))
    .where(eq(owner.handle, normalized))
    .limit(1);
  if (!person) {
    throw new Error("No user with that handle.");
  }
  const [row] = await db
    .insert(groupMember)
    .values({ group_id, user_id: person.user_id, role })
    .onConflictDoNothing()
    .returning();
  return {
    user_id: person.user_id,
    handle: person.handle,
    avatar_url: person.avatar_url ?? undefined,
    role: row?.role ?? (await groupRole(group_id, person.user_id)) ?? role,
    created_at: (row?.created_at ?? new Date()).toISOString(),
  };
}

// Change a member's role between admin and member. The owner role moves only
// through transferGroupOwnership, so this can never leave a group ownerless or
// race the partial unique index.
export async function setGroupRole(
  group_id: string,
  user_id: string,
  role: Exclude<GroupRole, "owner">,
): Promise<void> {
  const current = await groupRole(group_id, user_id);
  if (!current) {
    throw new Error("They're not in this group.");
  }
  if (current === "owner") {
    throw new Error("Transfer ownership before changing the owner's role.");
  }
  await db
    .update(groupMember)
    .set({ role })
    .where(and(eq(groupMember.group_id, group_id), eq(groupMember.user_id, user_id)));
}

// Hand the owner role to an existing member, demoting the current owner to
// admin. Both writes in one transaction, because the partial unique index
// forbids the moment in between where two rows claim `owner`.
export async function transferGroupOwnership(
  group_id: string,
  from_user_id: string,
  to_user_id: string,
): Promise<void> {
  if (from_user_id === to_user_id) return;
  const target = await groupRole(group_id, to_user_id);
  if (!target) {
    throw new Error("They're not in this group.");
  }
  await db.transaction(async (tx) => {
    // Demote first: the index allows zero owners, never two.
    await tx
      .update(groupMember)
      .set({ role: "admin" })
      .where(and(eq(groupMember.group_id, group_id), eq(groupMember.user_id, from_user_id)));
    await tx
      .update(groupMember)
      .set({ role: "owner" })
      .where(and(eq(groupMember.group_id, group_id), eq(groupMember.user_id, to_user_id)));
  });
}

// Remove a member. The owner cannot be removed — the group would be left with
// nobody able to administer it, and no database constraint catches that (a
// delete leaves no row for one to fire on), so it is refused here.
export async function removeGroupMember(group_id: string, user_id: string): Promise<void> {
  if ((await groupRole(group_id, user_id)) === "owner") {
    throw new Error("Transfer ownership before leaving the group.");
  }
  await db
    .delete(groupMember)
    .where(and(eq(groupMember.group_id, group_id), eq(groupMember.user_id, user_id)));
}

export async function updateGroup(
  group_id: string,
  updates: { name?: string; about?: string; avatar_url?: string },
): Promise<Group> {
  const { name, ...ownerUpdates } = updates;
  await db.transaction(async (tx) => {
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("Enter a name for the group.");
      }
      await tx.update(group).set({ name: trimmed }).where(eq(group.owner_id, group_id));
    }
    if (Object.keys(ownerUpdates).length > 0) {
      await tx.update(owner).set(ownerUpdates).where(eq(owner.id, group_id));
    }
  });
  const updated = await getGroup(group_id);
  if (!updated) {
    throw new Error("Group not found.");
  }
  return updated;
}

// Deletes the group. The owner row goes with it, and its channels cascade from
// there — the same path a deleted person's channels take. Callers authorize
// that the caller is the group's owner first.
export async function deleteGroup(group_id: string): Promise<void> {
  await db.delete(owner).where(eq(owner.id, group_id));
}
