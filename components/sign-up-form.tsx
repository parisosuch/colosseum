"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignUpForm({
  className,
  inviteRequired = true,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { inviteRequired?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
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
      if (inviteRequired) {
        // Pre-flight check so a bad code fails fast with a clear message. The
        // auth.users trigger is the authoritative gate; this is only UX, and a
        // code consumed between here and signUp still surfaces via the catch.
        const { data: codeOk, error: checkError } = await supabase.rpc("invite_code_available", {
          p_code: code,
        });
        if (checkError) throw checkError;
        if (!codeOk) {
          setError("That invite code is invalid or has already been used.");
          setIsLoading(false);
          return;
        }
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/onboarding`,
          // GoTrue stores this on the user's raw_user_meta_data, where the
          // invite-enforcement trigger reads and redeems it. Omitted for the
          // first account, which the trigger exempts.
          data: inviteRequired ? { invite_code: code } : {},
        },
      });
      if (error) throw error;
      // When email confirmation is disabled, sign-up returns an active session,
      // so go straight to onboarding to pick a handle. Otherwise prompt the
      // user to confirm their email first (they land on onboarding via the
      // confirmation link / root redirect once their profile is still missing).
      if (data.session) {
        // Signed in immediately (email confirmation disabled). Full-document
        // navigation so the server-rendered nav reflects the new session.
        window.location.assign("/auth/onboarding");
      } else {
        router.push("/auth/sign-up-success");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An error occurred";
      // A trigger exception during sign-up surfaces from GoTrue as a generic
      // "Database error saving new user" rather than our raised text, so a
      // race where the code is exhausted between the pre-check and signUp would
      // otherwise show an opaque message. Map it back to the likely cause.
      setError(
        /database error/i.test(message)
          ? "That invite code is invalid or has already been used."
          : message,
      );
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
