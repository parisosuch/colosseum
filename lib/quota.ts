import type { Quota } from "@/lib/colosseum/admin";

// "@alice", "@alice or @bob", or "an admin" when none are known. Used in limit
// messages so a user knows exactly who to ask.
export function adminContact(handles: string[]): string {
  if (handles.length === 0) return "an admin";
  if (handles.length === 1) return `@${handles[0]}`;
  const tags = handles.map((h) => `@${h}`);
  return `${tags.slice(0, -1).join(", ")} or ${tags[tags.length - 1]}`;
}

// A user-facing reason when a column add is (or would be) rejected for hitting
// the per-user limit, or null when the user still has room. Type-only import of
// Quota keeps this client-safe (no server-only pull from admin.ts).
export function columnLimitMessage(quota: Quota, admins: string[]): string | null {
  if (quota.limit === null || quota.used < quota.limit) return null;
  return quota.limit === 0
    ? `Adding columns is disabled for your account. Ask ${adminContact(admins)} about it.`
    : `You've reached your limit of ${quota.limit} columns. Ask ${adminContact(admins)} to raise it.`;
}
