"use client";

import { useEffect, useState } from "react";
import { CheckIcon, TriangleAlert } from "lucide-react";

import {
  createShareLinkAction,
  listShareLinksAction,
  revokeShareLinkAction,
} from "@/lib/colosseum/actions";
import type { ShareLink } from "@/lib/colosseum/share-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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

// Mirrors SHARE_EXPIRY_DAYS and its default in lib/colosseum/share-link.ts,
// which this client file can't import (it reaches the database).
const EXPIRY_CHOICES = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];
const DEFAULT_EXPIRY = "30";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("default", { month: "short", day: "numeric", year: "numeric" });

function expiryLabel(link: ShareLink): string {
  if (!link.expires_at) return "Never expires";
  return new Date(link.expires_at).getTime() <= Date.now()
    ? `Expired ${dateLabel(link.expires_at)}`
    : `Expires ${dateLabel(link.expires_at)}`;
}

// Revoke is confirm-gated like an API token's: the link was shown once, so a
// slipped click kills it for everyone it was sent to, with nothing to re-copy.
function RevokeLinkButton({ name, onRevoke }: { name: string; onRevoke: () => Promise<void> }) {
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
      setError(e instanceof Error ? e.message : "Couldn't revoke that link. Please try again.");
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
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Anyone you sent it to loses access on their next visit. A revoked link can&apos;t be
            restored; make a new one to share again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive-text">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
            variant="destructive"
          >
            {busy ? "Revoking..." : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Make, list and revoke a private channel's share links. With `blockId` it
// manages that block's links; without, the channel's — which lists block links
// too, since they all open something in this channel and the owner should be
// able to find every one from the channel settings.
export default function ShareLinks({
  channelId,
  blockId = null,
  divided = true,
}: {
  channelId: number;
  blockId?: number | null;
  // A rule above the section, for when it follows other settings.
  divided?: boolean;
}) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listShareLinksAction(channelId, blockId)
      .then((l) => active && setLinks(l))
      .catch(() => active && setLinks([]));
    return () => {
      active = false;
    };
  }, [channelId, blockId]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const { link, path } = await createShareLinkAction({
        channelId,
        blockId,
        label: label.trim() || null,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      });
      setLinks((prev) => [link, ...(prev ?? [])]);
      setNewUrl(`${window.location.origin}${path}`);
      setLabel("");
      setExpiry(DEFAULT_EXPIRY);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a link. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newUrl) return;
    try {
      await navigator.clipboard.writeText(newUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  const nameOf = (link: ShareLink) => link.label || "this link";

  return (
    <div className={divided ? "border-t pt-4 flex flex-col gap-2" : "flex flex-col gap-2"}>
      <Label>Share links</Label>
      <p className="text-xs text-muted-foreground">
        {blockId == null
          ? "Anyone with a link can open this channel and every block in it, with comments and members. They don't need an account and can't change anything."
          : "Anyone with a link can open this block and its comments. They don't need an account and can't change anything."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Link label"
          maxLength={100}
        />
        <Select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          aria-label="Link expires after"
          className="sm:w-44 sm:shrink-0"
        >
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value === "never" ? c.label : `Expires in ${c.label}`}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" onClick={handleCreate} disabled={creating}>
          {creating ? "Creating..." : "Create link"}
        </Button>
      </div>
      {expiry === "never" ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive-text">
          <TriangleAlert className="size-3.5 shrink-0 translate-y-px" aria-hidden />
          This link never expires. It keeps working for anyone who has it, including anyone it gets
          forwarded to, until you revoke it.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive-text">{error}</p> : null}

      {newUrl ? (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">Copy this link now. It won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-black/5 p-2 font-mono text-xs dark:bg-white/10">
              {newUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <CheckIcon size={14} /> Copied
                </>
              ) : (
                "Copy"
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {links && links.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{link.label || "Untitled link"}</p>
                <p className="text-caption">
                  {blockId == null
                    ? link.block_id == null
                      ? "Whole channel · "
                      : "One block · "
                    : ""}
                  {expiryLabel(link)} · made {dateLabel(link.created_at)}
                </p>
              </div>
              <RevokeLinkButton
                name={nameOf(link)}
                onRevoke={async () => {
                  await revokeShareLinkAction(link.id);
                  setLinks((prev) => (prev ?? []).filter((l) => l.id !== link.id));
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
