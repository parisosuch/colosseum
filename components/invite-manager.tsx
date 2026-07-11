"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon, CheckIcon, CopyIcon, LinkIcon, Trash2Icon } from "lucide-react";

import { createInviteCodeAction, revokeInviteCodeAction } from "@/lib/colosseum/actions";
import type { InviteCode } from "@/lib/colosseum/invite";
import { Button } from "@/components/ui/button";

export default function InviteManager({
  userId: _userId,
  initialCodes,
}: {
  userId: string;
  initialCodes: InviteCode[];
}) {
  const [codes, setCodes] = useState<InviteCode[]>(initialCodes);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const invite = await createInviteCodeAction({ max_uses: 1 });
      setCodes((prev) => [invite, ...prev]);
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
    setCodes((cs) => cs.filter((c) => c.code !== code));
    try {
      await revokeInviteCodeAction(code);
    } catch (e) {
      console.error(e);
      setCodes(prev);
      setError("Couldn't revoke that invite. Please try again.");
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
      <Button variant="secondary" onClick={handleCreate} disabled={creating}>
        <PlusIcon />
        <p>{creating ? "Creating..." : "New invite"}</p>
      </Button>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(invite.code)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2Icon size={14} /> Revoke
                    </Button>
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
