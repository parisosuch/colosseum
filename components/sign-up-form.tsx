"use client";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

// Better Auth's default minimum, which lib/auth.ts doesn't override. Stated in
// the form so the rule isn't first met as a server error after submitting.
const MIN_PASSWORD_LENGTH = 8;

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
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Shown under the repeat field as the user types, so the mismatch is called
  // out where it happened rather than at the bottom of the form on submit.
  const passwordsMismatch = repeatPassword !== "" && password !== repeatPassword;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Both fields are `required`, so a mismatch here always has the inline
    // message under the repeat field already showing.
    if (password !== repeatPassword) {
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
      // Sign-up starts a session immediately — the confirmation email that goes
      // out proves the address, it doesn't gate getting in — so go straight to
      // onboarding to pick a handle. Full-document navigation so the
      // server-rendered nav reflects the new session.
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
              autoComplete="email"
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
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                aria-describedby="password-hint"
                required
                className="pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p id="password-hint" className="text-caption">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="repeat-password">Repeat Password</Label>
            </div>
            <div className="relative">
              <Input
                id="repeat-password"
                type={showRepeatPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                className="pr-10"
                aria-invalid={passwordsMismatch}
                aria-describedby={passwordsMismatch ? "repeat-password-error" : undefined}
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowRepeatPassword((v) => !v)}
                aria-label={showRepeatPassword ? "Hide password" : "Show password"}
                aria-pressed={showRepeatPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              >
                {showRepeatPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {passwordsMismatch && (
              <p id="repeat-password-error" className="text-sm text-red-500">
                Passwords do not match
              </p>
            )}
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
