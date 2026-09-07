"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  addGroupMemberAction,
  removeGroupMemberAction,
  searchProfilesAction,
  setGroupRoleAction,
  transferGroupOwnershipAction,
} from "@/lib/colosseum/actions";
import type { GroupMember, GroupRole } from "@/lib/colosseum/group";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { UserProfilePicture } from "./user-profile-picture";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

// The roster editor, shown to a group's owner and admins. Roles are editable
// except for the owner's: that one moves only by transferring, which is a
// separate, confirmed action because it demotes the person doing it.
export default function GroupMembers({
  groupId,
  members,
  setMembers,
  viewerRole,
  viewerUserId,
}: {
  groupId: string;
  members: GroupMember[];
  setMembers: (next: GroupMember[]) => void;
  viewerRole: GroupRole;
  viewerUserId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferTo, setTransferTo] = useState<GroupMember | null>(null);

  // Debounced people search, with anyone already in the group filtered out. A
  // stale flag drops out-of-order responses (an earlier, slower query landing
  // after a later one).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const found = await searchProfilesAction(q);
        if (stale) return;
        const taken = new Set(members.map((m) => m.handle));
        setResults(found.filter((p) => !taken.has(p.handle)));
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, members]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = (handle: string) =>
    run(async () => {
      const member = await addGroupMemberAction(groupId, handle);
      setMembers(
        members.some((m) => m.user_id === member.user_id) ? members : [...members, member],
      );
      setQuery("");
      setResults([]);
    }, "Couldn't add them to the group.");

  const handleRole = (userId: string, role: Exclude<GroupRole, "owner">) =>
    run(async () => {
      await setGroupRoleAction(groupId, userId, role);
      setMembers(members.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    }, "Couldn't change that role.");

  const handleRemove = (userId: string) =>
    run(async () => {
      await removeGroupMemberAction(groupId, userId);
      setMembers(members.filter((m) => m.user_id !== userId));
    }, "Couldn't remove them.");

  const handleTransfer = (member: GroupMember) =>
    run(async () => {
      await transferGroupOwnershipAction(groupId, member.user_id);
      // The two roles swap: they become owner, you become an admin.
      setMembers(
        members.map((m) =>
          m.user_id === member.user_id
            ? { ...m, role: "owner" as const }
            : m.user_id === viewerUserId
              ? { ...m, role: "admin" as const }
              : m,
        ),
      );
      setTransferTo(null);
    }, "Couldn't transfer ownership.");

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      <Label>Members</Label>
      <p className="text-xs text-muted-foreground">
        Everyone here can add to the group&apos;s channels and read its private ones.
      </p>
      <div className="relative">
        <Input
          placeholder="Search people to add…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0] && !busy) {
              e.preventDefault();
              handleAdd(results[0].handle);
            }
          }}
        />
        {query.trim() ? (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {searching ? "Searching…" : "No people found."}
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto py-1">
                {results.map((p) => (
                  <li key={p.handle}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAdd(p.handle)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                    >
                      <UserProfilePicture avatarUrl={p.avatar_url} handle={p.handle} size="sm" />
                      <span className="truncate text-sm">@{p.handle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      {error && <p className="text-sm text-destructive-text">{error}</p>}
      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const isOwner = m.role === "owner";
          return (
            <li key={m.user_id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserProfilePicture avatarUrl={m.avatar_url} handle={m.handle} size="sm" />
                <span className="truncate text-sm">@{m.handle}</span>
              </div>
              <div className="flex items-center gap-1">
                {isOwner ? (
                  // The owner's role is not a dropdown: it moves only by
                  // transferring, which demotes whoever does it.
                  <span className="text-xs text-muted-foreground px-2">Owner</span>
                ) : (
                  <select
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                    aria-label={`Role for @${m.handle}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      handleRole(m.user_id, e.target.value as Exclude<GroupRole, "owner">)
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                {/* Only the current owner can hand the group on, and only to
                    someone already in it. */}
                {viewerRole === "owner" && !isOwner ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setTransferTo(m)}
                  >
                    Make owner
                  </Button>
                ) : null}
                {!isOwner ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove @${m.handle}`}
                    disabled={busy}
                    onClick={() => handleRemove(m.user_id)}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        An admin can also rename and delete the group&apos;s channels, and change who is in it.
      </p>

      <AlertDialog open={!!transferTo} onOpenChange={(o) => !o && setTransferTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make @{transferTo?.handle} the owner?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be able to delete the group. You stay on as an admin, and only they can
              hand it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => transferTo && handleTransfer(transferTo)}>
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
