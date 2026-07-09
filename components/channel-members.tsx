"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";

import { addChannelMemberAction, removeChannelMemberAction } from "@/lib/colosseum/actions";
import type { ChannelAccess } from "@/lib/colosseum/channel";
import type { ChannelMember } from "@/lib/colosseum/member";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// Owner-only roster editor: adds/removes members by handle. Members are owned by
// the board (fetched server-side and shared with the read-only members bar), so
// this is controlled — it mutates `members` through `setMembers`. The manage
// dialog renders it for public and private channels (members add to both).
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
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const member = await addChannelMemberAction(channelId, handle);
      // De-dupe: adding an existing member returns their row again.
      setMembers((prev) =>
        prev.some((m) => m.user_id === member.user_id) ? prev : [...prev, member],
      );
      setHandle("");
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
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Add by handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={adding || !handle.trim()}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </form>
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
