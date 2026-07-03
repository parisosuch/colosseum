"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createUserProfile,
  HandleTakenError,
  normalizeHandle,
  validateHandle,
} from "@/lib/colosseum/user";

export function OnboardingForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    const normalized = normalizeHandle(handle);
    const validationError = validateHandle(normalized);
    if (validationError) {
      setError(validationError);
      setIsLoading(false);
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      await createUserProfile(supabase, user.id, normalized);
      // Full-document navigation so the server-rendered nav (root layout) picks
      // up the new profile (avatar) instead of the cached pre-profile render.
      window.location.assign(`/${normalized}`);
    } catch (err: unknown) {
      if (err instanceof HandleTakenError) {
        setError("That handle is already taken. Try another.");
      } else {
        setError(err instanceof Error ? err.message : "An error occurred");
      }
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
