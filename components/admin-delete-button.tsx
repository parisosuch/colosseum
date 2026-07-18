"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";

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
import { Button } from "@/components/ui/button";

// Admin moderation affordance: a destructive, confirm-gated delete shown to
// admins on public/open content they don't own. Reused for both channels and
// blocks — the caller supplies the label and the server action to run.
export default function AdminDeleteButton({
  label,
  description,
  onDelete,
  size = "icon",
}: {
  label: string;
  description: string;
  onDelete: () => Promise<void>;
  size?: "icon" | "sm";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't delete.");
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="secondary"
          size={size}
          aria-label={label}
          className="text-destructive hover:text-destructive"
        >
          <ShieldAlert />
          {size === "sm" ? <span>{label}</span> : null}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              // Keep the dialog open while the action runs / on error.
              e.preventDefault();
              void run();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Deleting..." : label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
