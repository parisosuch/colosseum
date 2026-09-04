"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { leaveChannelAction } from "@/lib/colosseum/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Self-service Leave for a channel you're a member of (not the owner). Lives in
// the channel board's action row; on success it returns you to the owner's
// profile since a member can no longer read a private channel they've left.
export function LeaveChannelButton({
  channelId,
  handle,
  title,
  isPrivate,
}: {
  channelId: number;
  handle: string;
  title: string;
  isPrivate: boolean;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    try {
      await leaveChannelAction(channelId);
      toast.success("Left channel.");
      router.push(`/${handle}`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't leave that channel. Please try again.");
      setLeaving(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive-text hover:text-destructive-text"
          disabled={leaving}
        >
          Leave
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {isPrivate
              ? "You'll lose access to this private channel and need a new invite to rejoin."
              : "You'll be removed as a member of this channel."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={leave}>
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
