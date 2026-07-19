import { eq, sql } from "drizzle-orm";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appSettings, column, inviteCode, user, userProfile } from "@/lib/db/schema";

// Instance-wide limits. null = unlimited, 0 = none, N = cap. Stored as a single
// pinned row (id = 1); see the app_settings table in lib/db/schema.ts.
export type AppSettings = {
  max_invites_per_user: number | null;
  max_columns_per_user: number | null;
};

const DEFAULT_SETTINGS: AppSettings = {
  max_invites_per_user: null,
  max_columns_per_user: null,
};

export async function getAppSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    max_invites_per_user: row.max_invites_per_user,
    max_columns_per_user: row.max_columns_per_user,
  };
}

export async function updateAppSettings(input: AppSettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: 1, ...input })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...input, updated_at: new Date() } });
}

// A per-user override wins over the global default when set; otherwise the
// global applies, and a null global means unlimited.
export function effectiveLimit(override: number | null, global: number | null): number | null {
  return override ?? global;
}

// Handles of the instance admins (onboarded ones only, so they're linkable),
// oldest first. Surfaced in limit messages so a user knows who to ask.
export async function getAdminHandles(): Promise<string[]> {
  const rows = await db
    .select({ handle: userProfile.handle })
    .from(user)
    .innerJoin(userProfile, eq(userProfile.user_id, user.id))
    .where(eq(user.is_admin, true))
    .orderBy(user.createdAt);
  return rows.map((r) => r.handle);
}

// The signed-in admin, or a thrown error. Actions that moderate content or
// change limits gate on this. Non-admins (and banned users, already nulled by
// getSessionUser) are rejected.
export async function requireAdmin() {
  const u = await getSessionUser();
  if (!u?.is_admin) {
    throw new Error("Not authorized.");
  }
  return u;
}

// A row in the admin users table: identity plus current usage against limits.
export type AdminUser = {
  user_id: string;
  handle: string | null;
  email: string;
  is_admin: boolean;
  banned: boolean;
  invite_limit: number | null;
  column_limit: number | null;
  invites_used: number;
  columns_used: number;
};

export async function listUsers(): Promise<AdminUser[]> {
  const users = await db
    .select({
      user_id: user.id,
      email: user.email,
      is_admin: user.is_admin,
      banned: user.banned,
      invite_limit: user.invite_limit,
      column_limit: user.column_limit,
      handle: userProfile.handle,
    })
    .from(user)
    .leftJoin(userProfile, eq(userProfile.user_id, user.id))
    .orderBy(user.createdAt);

  // Usage aggregated per user in two grouped scans, then stitched in JS. Invite
  // "usage" is total capacity handed out (sum of max_uses), matching how the
  // limit is enforced at mint time.
  const inviteRows = await db
    .select({
      created_by: inviteCode.created_by,
      total: sql<number>`coalesce(sum(${inviteCode.max_uses}), 0)`,
    })
    .from(inviteCode)
    .groupBy(inviteCode.created_by);
  const invitesByUser = new Map(inviteRows.map((r) => [r.created_by, Number(r.total)]));

  const columnRows = await db
    .select({ created_by: column.created_by, total: sql<number>`count(*)` })
    .from(column)
    .groupBy(column.created_by);
  const columnsByUser = new Map(columnRows.map((r) => [r.created_by, Number(r.total)]));

  return users.map((u) => ({
    ...u,
    invites_used: invitesByUser.get(u.user_id) ?? 0,
    columns_used: columnsByUser.get(u.user_id) ?? 0,
  }));
}

export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  // Admins can't be banned — prevents an operator locking themselves out.
  const [target] = await db
    .select({ is_admin: user.is_admin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) throw new Error("No such user.");
  if (target.is_admin && banned) throw new Error("Admins can't be banned.");
  await db.update(user).set({ banned }).where(eq(user.id, userId));
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) {
    // Never demote the last admin — that would leave the instance with no one
    // who can moderate.
    const [{ admins }] = await db
      .select({ admins: sql<number>`count(*)` })
      .from(user)
      .where(eq(user.is_admin, true));
    if (Number(admins) <= 1) throw new Error("Can't remove the last admin.");
  }
  await db.update(user).set({ is_admin: isAdmin }).where(eq(user.id, userId));
}

export async function setUserLimits(
  userId: string,
  limits: { invite_limit: number | null; column_limit: number | null },
): Promise<void> {
  await db.update(user).set(limits).where(eq(user.id, userId));
}

// A user's standing against a limit. `limit` is the effective cap (null =
// unlimited, 0 = none); `used` is current consumption. Drives the invite
// progress bar and the friendly limit messages.
export type Quota = { limit: number | null; used: number };

// How many invites (summed code capacity) the user has issued, against their
// effective invite limit. Admins report an unlimited (null) limit.
export async function getInviteQuota(userId: string): Promise<Quota> {
  const [{ used }] = await db
    .select({ used: sql<number>`coalesce(sum(${inviteCode.max_uses}), 0)` })
    .from(inviteCode)
    .where(eq(inviteCode.created_by, userId));
  const usedCount = Number(used);

  const [u] = await db
    .select({ is_admin: user.is_admin, invite_limit: user.invite_limit })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u || u.is_admin) return { limit: null, used: usedCount };

  const settings = await getAppSettings();
  return { limit: effectiveLimit(u.invite_limit, settings.max_invites_per_user), used: usedCount };
}

// How many columns the user has created, against their effective column limit.
export async function getColumnQuota(userId: string): Promise<Quota> {
  const [{ used }] = await db
    .select({ used: sql<number>`count(*)` })
    .from(column)
    .where(eq(column.created_by, userId));
  const usedCount = Number(used);

  const [u] = await db
    .select({ is_admin: user.is_admin, column_limit: user.column_limit })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u || u.is_admin) return { limit: null, used: usedCount };

  const settings = await getAppSettings();
  return { limit: effectiveLimit(u.column_limit, settings.max_columns_per_user), used: usedCount };
}

// Throws if minting `additional` more invite capacity would exceed the user's
// effective invite limit. Admins are exempt; a null limit is unlimited.
export async function assertInviteQuota(userId: string, additional: number): Promise<void> {
  const { limit, used } = await getInviteQuota(userId);
  if (limit === null) return;
  if (limit === 0) throw new Error("Invites are disabled for your account.");
  if (used + additional > limit) {
    throw new Error(`Your invite limit is ${limit}.`);
  }
}

// Throws if the user is already at their effective column limit. Admins exempt;
// null limit is unlimited.
export async function assertColumnQuota(userId: string): Promise<void> {
  const { limit, used } = await getColumnQuota(userId);
  if (limit === null) return;
  if (limit === 0) throw new Error("Adding columns is disabled for your account.");
  if (used >= limit) {
    throw new Error(`You've reached your limit of ${limit} columns.`);
  }
}
