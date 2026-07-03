"use client";

import { useState } from "react";
import { PlusIcon, CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";

import { revokeApiTokenAction } from "@/lib/colosseum/actions";
import type { ApiToken } from "@/lib/colosseum/api-token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      setError("Couldn't revoke that token. Please try again.");
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRevoke(token.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2Icon size={14} /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
