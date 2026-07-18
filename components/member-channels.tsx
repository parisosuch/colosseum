"use client";

import Link from "next/link";
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

export type MemberChannel = {
  id: number;
  title: string;
  handle: string;
  private: boolean;
};

// The "Member of" section on your own profile: channels you've been invited to
// (not ones you own), each with a self-service Leave. Owns the list state so a
// leave drops the row immediately; router.refresh() reconciles the server view.
export function MemberChannels({ channels }: { channels: MemberChannel[] }) {
  const router = useRouter();
  const [list, setList] = useState(channels);
  const [leaving, setLeaving] = useState<number | null>(null);

  const leave = async (id: number) => {
    setLeaving(id);
    try {
      await leaveChannelAction(id);
      setList((l) => l.filter((c) => c.id !== id));
      toast.success("Left channel.");
      router.refresh();
    } catch (e) {
      console.error(e);
      toast.error("Couldn't leave that channel. Please try again.");
    } finally {
      setLeaving(null);
    }
  };

  if (list.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-label">Member of</h2>
      <ul className="divide-y rounded-md border">
        {list.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 p-3">
            <Link href={`/${c.handle}/${c.id}`} className="min-w-0 truncate hover:underline">
              <span className="truncate">{c.title}</span>
              <span className="text-muted-foreground"> · @{c.handle}</span>
              {c.private ? (
                <span className="ml-1 text-xs text-muted-foreground">private</span>
              ) : null}
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={leaving === c.id}
                >
                  Leave
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Leave “{c.title}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {c.private
                      ? "You'll lose access to this private channel and need a new invite to rejoin."
                      : "You'll be removed as a member of this channel."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={() => leave(c.id)}
                  >
                    Leave
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </section>
  );
}
