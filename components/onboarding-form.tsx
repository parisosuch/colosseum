"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { useEffect, useState } from "react";
import { createUserProfileAction, isHandleAvailableAction } from "@/lib/colosseum/actions";
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  normalizeHandle,
  sanitizeHandleInput,
  validateHandle,
} from "@/lib/colosseum/handle";

// Long enough that a fast typist doesn't fire a lookup per keystroke, short
// enough that the answer is there before they reach for the button.
const CHECK_DELAY_MS = 400;

export function OnboardingForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "free" | "taken">("idle");

  const normalized = normalizeHandle(handle);
  // The rule the current input breaks, if any. Only once they've typed
  // something, so the field doesn't open by complaining about being empty.
  const rule = normalized ? validateHandle(normalized) : null;

  // Uniqueness is the one rule the browser can't check for itself, so ask the
  // server on a pause rather than making them submit to find out.
  useEffect(() => {
    if (!normalized || rule) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("checking");
    const timer = setTimeout(() => {
      isHandleAvailableAction(normalized)
        .then((free) => {
          if (cancelled) return;
          setStatus(free === null ? "idle" : free ? "free" : "taken");
        })
        .catch(() => {
          // The check is a convenience; submitting is still authoritative.
          if (!cancelled) setStatus("idle");
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // The action validates the handle, resolves the user from their session,
      // and creates the profile — returning a message on any user-facing error.
      const result = await createUserProfileAction(normalized);
      if (!result.ok) {
        setError(
          result.handleTaken ? "That handle is already taken. Try another." : result.message,
        );
        setIsLoading(false);
        return;
      }
      // Explore, not their own profile: the last screen of sign-up should show
      // what other people have made rather than announce that they have nothing
      // yet. Full-document navigation so the server-rendered nav (root layout)
      // picks up the new profile instead of the cached pre-profile render.
      window.location.assign("/explore");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2">
        <Logo className="h-4 w-auto text-muted-foreground opacity-25" />
        <h1 className="text-title">Choose your handle</h1>
        <p className="text-muted-foreground">
          This is your unique username and the address of your profile.
        </p>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="handle">Handle</Label>
            <Input
              id="handle"
              type="text"
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={HANDLE_MAX_LENGTH}
              aria-describedby="handle-rules"
              required
              value={handle}
              // Rewritten as they type, so what's in the field is the handle
              // they'll get: a space becomes a hyphen, a period or an @ goes.
              onChange={(e) => setHandle(sanitizeHandleInput(e.target.value))}
            />
            <p id="handle-rules" className="text-caption">
              {HANDLE_MIN_LENGTH} to {HANDLE_MAX_LENGTH} characters. Lowercase letters, numbers,
              hyphens and underscores.
            </p>
            {rule && <p className="text-sm text-red-500">{rule}</p>}
            {!rule && status === "checking" && <p className="text-caption">Checking...</p>}
            {!rule && status === "free" && (
              <p className="text-caption">/{normalized} is available.</p>
            )}
            {!rule && status === "taken" && (
              <p className="text-sm text-red-500">That handle is already taken. Try another.</p>
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || Boolean(rule) || status === "taken"}
          >
            {isLoading ? "Creating your profile..." : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}
