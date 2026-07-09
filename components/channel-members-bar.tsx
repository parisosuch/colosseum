"use client";

import Link from "next/link";

import type { ChannelMember } from "@/lib/colosseum/member";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// How many avatars to show inline before collapsing the rest behind a
// "View all members" button.
const MAX_VISIBLE = 5;

// The owner (implicit member) plus invited members, in one list. `owner` is
// flagged so it can be labelled in the tooltip and the modal.
type Entry = { handle: string; avatarUrl?: string | null; owner: boolean };

function initials(handle: string): string {
  return handle.slice(0, 2).toUpperCase();
}

// A profile-linked avatar with the handle (and an "owner" note) in a tooltip.
function AvatarLink({ entry, className }: { entry: Entry; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/${entry.handle}`} className={className}>
          <Avatar className="size-7 border-2 border-background">
            <AvatarImage src={entry.avatarUrl ?? undefined} />
            <AvatarFallback className="text-[10px]">{initials(entry.handle)}</AvatarFallback>
          </Avatar>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        @{entry.handle}
        {entry.owner ? " · owner" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

// Read-only roster shown on the channel board: overlapping avatars (owner first),
// capped at MAX_VISIBLE with the remainder behind a modal. The channel page only
// passes members for channels that have them, so this renders nothing otherwise.
export default function ChannelMembersBar({
  ownerHandle,
  ownerAvatarUrl,
  members,
}: {
  ownerHandle: string;
  ownerAvatarUrl?: string | null;
  members: ChannelMember[];
}) {
  if (members.length === 0) return null;

  // Owner first, then members — de-duped by handle so the owner is never also
  // listed as a plain member (which would collide React keys). The owner entry
  // wins, keeping its `owner` flag.
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const e of [
    { handle: ownerHandle, avatarUrl: ownerAvatarUrl, owner: true },
    ...members.map((m) => ({ handle: m.handle, avatarUrl: m.avatar_url, owner: false })),
  ]) {
    if (seen.has(e.handle)) continue;
    seen.add(e.handle);
    entries.push(e);
  }
  const visible = entries.slice(0, MAX_VISIBLE);
  const hasOverflow = entries.length > MAX_VISIBLE;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-label">Members</h2>
      <div className="flex items-center gap-3">
        <TooltipProvider delayDuration={100}>
          <div className="flex -space-x-2">
            {visible.map((entry) => (
              <AvatarLink key={entry.handle} entry={entry} className="hover:z-10" />
            ))}
          </div>
        </TooltipProvider>

        {hasOverflow ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                View all members
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Members</DialogTitle>
              <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
                {entries.map((entry) => (
                  <li key={entry.handle}>
                    <Link
                      href={`/${entry.handle}`}
                      className="flex items-center gap-2 rounded-md p-2 hover:bg-accent"
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={entry.avatarUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {initials(entry.handle)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">@{entry.handle}</span>
                      {entry.owner ? (
                        <span className="text-xs text-muted-foreground">owner</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
