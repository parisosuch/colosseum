"use client";

import { useState } from "react";
import { PlusIcon, CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";

import { revokeApiTokenAction } from "@/lib/colosseum/actions";
import type { ApiToken } from "@/lib/colosseum/api-token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Revoke is confirm-gated: the plaintext was shown exactly once, so a slipped
// click breaks every script holding it with nothing to undo and nothing to
// re-copy. The dialog names the token so the admin can see which one dies.
function RevokeTokenButton({
  token,
  onRevoke,
}: {
  token: ApiToken;
  onRevoke: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = token.name?.trim() ? token.name : `${token.token_prefix}…`;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRevoke();
      setOpen(false);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't revoke that token. Please try again.");
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
          className="text-destructive hover:text-destructive"
        >
          <Trash2Icon size={14} /> Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests signed with this token start failing immediately, and anything running on it
            stops working. The token can&apos;t be restored — you&apos;d have to create a new one
            and update whatever uses it.
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

export default function ApiTokenManager({
  userId: _userId,
  initialTokens,
}: {
  userId: string;
  initialTokens: ApiToken[];
}) {
  const [tokens, setTokens] = useState<ApiToken[]>(initialTokens);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plaintext of the most recently created token. Shown once, then unrecoverable.
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      // Created server-side: the token is hashed there and the plaintext is
      // returned exactly once in this response.
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || null }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const { token, ...row } = await res.json();
      setNewToken(token);
      setCopied(false);
      setTokens((prev) => [row as ApiToken, ...prev]);
      setName("");
    } catch (e) {
      console.error(e);
      setError("Couldn't create a token. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    const prev = tokens;
    setTokens((t) => t.filter((x) => x.id !== id));
    try {
      await revokeApiTokenAction(id);
    } catch (e) {
      console.error(e);
      setTokens(prev);
      // Rethrown so the confirmation dialog can report it in place.
      throw new Error("Couldn't revoke that token. Please try again.", { cause: e });
    }
  };

  const handleCopy = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">API tokens</h2>
        <p className="text-sm text-muted-foreground">
          Authenticate requests to the REST API with{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (optional)"
          aria-label="Token name"
          maxLength={100}
          className="sm:max-w-xs"
        />
        <Button variant="secondary" onClick={handleCreate} disabled={creating}>
          <PlusIcon />
          <span>{creating ? "Creating..." : "New token"}</span>
        </Button>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {newToken ? (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">Copy your token now — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-black/5 p-2 font-mono text-sm dark:bg-white/10">
              {newToken}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <CheckIcon size={14} /> Copied
                </>
              ) : (
                <>
                  <CopyIcon size={14} /> Copy
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-4 p-3">
              <div className="flex flex-col">
                <span className="font-mono text-sm">{token.token_prefix}…</span>
                {token.name ? <span className="text-sm">{token.name}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {token.last_used_at
                    ? `Last used ${new Date(token.last_used_at).toLocaleDateString()}`
                    : "Never used"}
                </span>
              </div>
              <RevokeTokenButton token={token} onRevoke={() => handleRevoke(token.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
