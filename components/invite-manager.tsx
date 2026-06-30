"use client";

import { useState } from "react";
import { PlusIcon, CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { createInviteCode, revokeInviteCode, InviteCode } from "@/lib/colosseum/invite";
import { Button } from "@/components/ui/button";

export default function InviteManager({
  userId,
  initialCodes,
}: {
  userId: string;
  initialCodes: InviteCode[];
}) {
  const [codes, setCodes] = useState<InviteCode[]>(initialCodes);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const supabase = createClient();

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const invite = await createInviteCode(supabase, { created_by: userId, max_uses: 1 });
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
      await revokeInviteCode(supabase, code);
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
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {exhausted ? "Used" : `${invite.uses}/${invite.max_uses} used`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(invite.code)}
                    disabled={exhausted}
                    className="flex items-center gap-1 text-sm underline disabled:no-underline disabled:opacity-40"
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
                  </button>
                  {invite.uses === 0 ? (
                    <button
                      type="button"
                      onClick={() => handleRevoke(invite.code)}
                      className="flex items-center gap-1 text-sm text-red-500 underline"
                    >
                      <Trash2Icon size={14} /> Revoke
                    </button>
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
