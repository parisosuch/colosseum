"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";

import {
  addChannelMemberAction,
  removeChannelMemberAction,
  searchProfilesAction,
} from "@/lib/colosseum/actions";
import type { ChannelAccess } from "@/lib/colosseum/channel";
import type { ChannelMember } from "@/lib/colosseum/member";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { UserProfilePicture } from "./user-profile-picture";

// Owner-only roster editor: search users and add/remove members. Members are
// owned by the board (fetched server-side and shared with the read-only members
// bar), so this is controlled — it mutates `members` through `setMembers`. The
// manage dialog renders it for public and private channels (members add to both).
export default function ChannelMembers({
  channelId,
  access,
  members,
  setMembers,
}: {
  channelId: number;
  access: ChannelAccess;
  members: ChannelMember[];
  setMembers: Dispatch<SetStateAction<ChannelMember[]>>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Debounced user search. Existing members are filtered out of the results so
  // you can't pick someone who's already in. A stale flag drops out-of-order
  // responses (an earlier, slower query resolving after a later one).
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

  const handleAdd = async (handle: string) => {
    setAdding(true);
    setError(null);
    try {
      const member = await addChannelMemberAction(channelId, handle);
      // De-dupe: adding an existing member returns their row again.
      setMembers((prev) =>
        prev.some((m) => m.user_id === member.user_id) ? prev : [...prev, member],
      );
      setQuery("");
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that member.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      await removeChannelMemberAction(channelId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    }
  };

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      <Label>Members</Label>
      <p className="text-xs text-muted-foreground">
        {access === "private"
          ? "Only you and these members can view or add to this private channel."
          : "Anyone can view this channel; only you and these members can add to it."}
      </p>
      <div className="relative">
        <Input
          placeholder="Search users to add…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Enter adds the top match, for keyboard flow.
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0] && !adding) {
              e.preventDefault();
              handleAdd(results[0].handle);
            }
          }}
        />
        {query.trim() ? (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {searching ? "Searching…" : "No users found."}
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto py-1">
                {results.map((p) => (
                  <li key={p.handle}>
                    <button
                      type="button"
                      disabled={adding}
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
      {error && <p className="text-sm text-red-500">{error}</p>}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between">
              <span className="text-sm">@{m.handle}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove @${m.handle}`}
                onClick={() => handleRemove(m.user_id)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
