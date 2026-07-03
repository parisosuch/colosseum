"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { createUserProfileAction } from "@/lib/colosseum/actions";
import { normalizeHandle } from "@/lib/colosseum/handle";

export function OnboardingForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const normalized = normalizeHandle(handle);

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
      // Full-document navigation so the server-rendered nav (root layout) picks
      // up the new profile (avatar) instead of the cached pre-profile render.
      window.location.assign(`/${normalized}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-title">Choose your handle</CardTitle>
          <CardDescription>
            This is your unique username and the address of your profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  spellCheck={false}
                  required
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating your profile..." : "Continue"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
