"use client";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";

export function SignUpForm({
  className,
  inviteRequired = true,
  invite = "",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { inviteRequired?: boolean; invite?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(invite);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    const code = inviteCode.trim();
    if (inviteRequired && !code) {
      setError("An invite code is required to sign up.");
      setIsLoading(false);
      return;
    }

    try {
      // The server's user-create hook is the authoritative invite gate; a bad
      // or spent code comes back as this call's error message. The name field
      // is required by Better Auth but unused by the app (identity is the
      // handle picked at onboarding), so default it to the email's local part.
      const { error } = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0],
        ...(inviteRequired ? { inviteCode: code } : {}),
      });
      if (error) throw new Error(error.message ?? "Could not sign up.");
      // Sign-up starts a session immediately (no email confirmation step), so
      // go straight to onboarding to pick a handle. Full-document navigation
      // so the server-rendered nav reflects the new session.
      window.location.assign("/auth/onboarding");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2">
        <Logo className="h-4 w-auto text-muted-foreground opacity-25" />
        <h1 className="text-title">Sign up</h1>
        <p className="text-muted-foreground">
          {inviteRequired
            ? "Colosseum is invite only — you'll need a code."
            : "Create the first account for this Colosseum."}
        </p>
      </div>
      <form onSubmit={handleSignUp}>
        <div className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="password">Password</Label>
            </div>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="repeat-password">Repeat Password</Label>
            </div>
            <Input
              id="repeat-password"
              type="password"
              required
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
            />
          </div>
          {inviteRequired && (
            <div className="grid gap-2">
              <Label htmlFor="invite-code">Invite code</Label>
              <Input
                id="invite-code"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Required"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating an account..." : "Sign up"}
          </Button>
        </div>
        <div className="mt-4 text-center text-sm">
          Already have an account?{" "}
          <Link href="/auth/login" className="underline underline-offset-4">
            Login
          </Link>
        </div>
      </form>
    </div>
  );
}
