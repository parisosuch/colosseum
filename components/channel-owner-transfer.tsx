"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  getMyProfileAction,
  listMyGroupsAction,
  transferChannelAction,
} from "@/lib/colosseum/actions";
import type { Channel } from "@/lib/colosseum/channel";
import type { Group, GroupRole } from "@/lib/colosseum/group";
import { Label } from "./ui/label";
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

// Move a channel between you and a group you manage. Confirmed rather than
// applied on change, because ownership is what grants access: handing a private
// channel to a group opens it to everyone in that group, and taking one back
// closes it to them. The dialog says so before it happens.
//
// Renders nothing when the viewer manages no groups — there is nowhere to move
// it to, and an empty picker is worse than no picker.
//
// It resolves who "you" are itself rather than taking it as a prop: the route's
// handle is the channel *owner's*, which for a group-owned channel is not the
// viewer's, and threading two more props through the board to say so would be
// worse than the one request this already makes for the group list.
export default function ChannelOwnerTransfer({ channel }: { channel: Channel }) {
  const [groups, setGroups] = useState<(Group & { role: GroupRole })[]>([]);
  const [me, setMe] = useState<{ ownerId: string; handle: string } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let stale = false;
    Promise.all([listMyGroupsAction(), getMyProfileAction()])
      .then(([gs, profile]) => {
        if (stale) return;
        setGroups(gs.filter((g) => g.role !== "member"));
        if (profile) setMe({ ownerId: profile.owner_id, handle: profile.handle });
      })
      .catch(() => {
        // No options offered is the right fallback: the channel stays put.
      });
    return () => {
      stale = true;
    };
  }, []);

  if (groups.length === 0 || !me) return null;
  const { ownerId: myOwnerId, handle: myHandle } = me;

  const options = [
    { id: myOwnerId, label: `You (@${myHandle})` },
    ...groups.map((g) => ({ id: g.id, label: `${g.name} (@${g.handle})` })),
  ];
  const targetOption = options.find((o) => o.id === target);
  const currentLabel = options.find((o) => o.id === channel.owned_by)?.label ?? "someone else";

  const handleTransfer = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await transferChannelAction(channel.id, target);
      const moved = groups.find((g) => g.id === target);
      setTarget(null);
      // The channel now lives under a different handle, so the current URL is
      // stale — push the new one rather than refreshing this one.
      router.push(`/${moved ? moved.handle : myHandle}/${channel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move the channel.");
      setBusy(false);
    }
  };

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      <Label htmlFor="channel-owner">Belongs to</Label>
      <p className="text-xs text-muted-foreground">
        Whoever owns this channel decides who can read and manage it. Currently {currentLabel}.
      </p>
      <select
        id="channel-owner"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={channel.owned_by}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value !== channel.owned_by) setTarget(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive-text">{error}</p>}

      <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this channel to {targetOption?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {targetOption?.id === myOwnerId
                ? "It becomes yours alone. The group's members lose the access their membership gave them, and the channel moves to your handle."
                : `Everyone in the group can add to it, and — if it's private — read it. It moves to the group's handle, so its current link changes.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTransfer}>Move</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
