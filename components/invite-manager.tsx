"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon, CheckIcon, CopyIcon, LinkIcon, Trash2Icon } from "lucide-react";

import { createInviteCodeAction, revokeInviteCodeAction } from "@/lib/colosseum/actions";
import type { InviteCode } from "@/lib/colosseum/invite";
import type { Quota } from "@/lib/colosseum/admin";
import { adminContact } from "@/lib/quota";
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

// Revoke is confirm-gated and names the code: it sits next to Copy and Link,
// the row's routine actions, and it drops the code with nothing to undo.
function RevokeInviteButton({ code, onRevoke }: { code: string; onRevoke: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRevoke();
      setOpen(false);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't revoke that invite. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive-text hover:text-destructive-text"
        >
          <Trash2Icon size={14} /> Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Anyone holding this code can no longer sign up with it, and neither the code nor the
            link you shared can be brought back. The capacity it reserved returns to your quota.
          </AlertDialogDescription>
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
            {busy ? "Revoking..." : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function InviteManager({
  userId: _userId,
  initialCodes,
  initialQuota,
  admins,
}: {
  userId: string;
  initialCodes: InviteCode[];
  initialQuota: Quota;
  admins: string[];
}) {
  const contact = adminContact(admins);
  const [codes, setCodes] = useState<InviteCode[]>(initialCodes);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);

  // Invite quota. `limit` null = unlimited (no bar); 0 = disabled by admin.
  // `used` is capacity issued (sum of code max_uses) and moves as codes are
  // created/revoked. `limitMessage` carries a server-side rejection, shown
  // inline under the meter that already states the cap.
  const { limit } = initialQuota;
  const [used, setUsed] = useState(initialQuota.used);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const atCap = limit !== null && used >= limit;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setLimitMessage(null);
    try {
      const result = await createInviteCodeAction({ max_uses: 1 });
      if (!result.ok) {
        setLimitMessage(result.message);
        return;
      }
      setCodes((prev) => [result.invite, ...prev]);
      setUsed((u) => u + result.invite.max_uses);
    } catch (e) {
      console.error(e);
      setError("Couldn't create an invite. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (code: string) => {
    setError(null);
    const prev = codes;
    const revoked = codes.find((c) => c.code === code);
    setCodes((cs) => cs.filter((c) => c.code !== code));
    try {
      await revokeInviteCodeAction(code);
      // Revoking an unused code frees the capacity it reserved.
      if (revoked) setUsed((u) => Math.max(0, u - revoked.max_uses));
    } catch (e) {
      console.error(e);
      setCodes(prev);
      // Rethrown so the confirmation dialog can report it in place.
      throw new Error("Couldn't revoke that invite. Please try again.", { cause: e });
    }
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  // Shareable link that lands the invitee on sign-up with the code prefilled.
  const inviteLink = (code: string) =>
    `${window.location.origin}/auth/sign-up?invite=${encodeURIComponent(code)}`;

  const handleCopyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setLinkCopied(code);
      setTimeout(() => setLinkCopied((c) => (c === code ? null : c)), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Quota meter — shown only when the admin has set a cap. */}
      {limit === 0 ? (
        <p className="text-sm text-muted-foreground">
          Invites are disabled for your account. Ask {contact} about it.
        </p>
      ) : limit !== null ? (
        <div className="max-w-md space-y-1">
          <div className="text-caption flex justify-between tabular-nums">
            {/* Counts codes made, not redemptions — the per-code "n/m used"
                below is the one that tracks people signing up. */}
            <span>
              {used} of {limit} invite codes created
            </span>
            <span>{remaining} left to create</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <Button variant="secondary" onClick={handleCreate} disabled={creating || atCap}>
        <PlusIcon />
        <p>{creating ? "Creating..." : "New invite"}</p>
      </Button>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {limitMessage ? (
        <p className="text-sm text-muted-foreground">
          {limitMessage} Ask {contact} to raise it if you need more.
        </p>
      ) : null}

      {codes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No invites yet. Create one to invite someone.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {codes.map((invite) => {
            const exhausted = invite.uses >= invite.max_uses;
            return (
              <li key={invite.code} className="flex items-center justify-between gap-4 p-3">
                <div className="flex flex-col">
                  <span
                    className={`font-mono text-lg ${exhausted ? "line-through opacity-50" : ""}`}
                  >
                    {invite.code}
                  </span>
                  {invite.note ? (
                    <span className="text-xs text-muted-foreground">{invite.note}</span>
                  ) : null}
                  {invite.redeemers.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Used by{" "}
                      {invite.redeemers.map((handle, i) => (
                        <span key={handle}>
                          {i > 0 ? ", " : ""}
                          <Link href={`/${handle}`} className="underline hover:text-foreground">
                            @{handle}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {exhausted ? "Used" : `${invite.uses}/${invite.max_uses} used`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(invite.code)}
                    disabled={exhausted}
                  >
                    {copied === invite.code ? (
                      <>
                        <CheckIcon size={14} /> Copied
                      </>
                    ) : (
                      <>
                        <CopyIcon size={14} /> Copy
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyLink(invite.code)}
                    disabled={exhausted}
                  >
                    {linkCopied === invite.code ? (
                      <>
                        <CheckIcon size={14} /> Copied
                      </>
                    ) : (
                      <>
                        <LinkIcon size={14} /> Link
                      </>
                    )}
                  </Button>
                  {invite.uses === 0 ? (
                    <RevokeInviteButton
                      code={invite.code}
                      onRevoke={() => handleRevoke(invite.code)}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
