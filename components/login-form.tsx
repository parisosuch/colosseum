"use client";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getMyProfileAction } from "@/lib/colosseum/actions";
import { safeNextPath } from "@/lib/next-path";
import { signUpHref, type SignupState } from "@/lib/signup-state";

export function LoginForm({
  className,
  invite = "",
  next = "",
  passwordUpdated = false,
  signupState = "invite",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  invite?: string;
  next?: string;
  passwordUpdated?: boolean;
  signupState?: SignupState;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) throw new Error(error.message ?? "Could not log in.");
      // Get user profile and redirect to profile (the action reads the session).
      const userProfile = await getMyProfileAction();
      // Full-document navigation (not router.push): the nav lives in the root
      // layout as a server component that reads auth, and a client push won't
      // re-render it. A real navigation makes the server render it with the new
      // session.
      // a user who signed up but never picked a handle has no profile yet
      if (!userProfile) {
        window.location.assign("/auth/onboarding");
        return;
      }
      // Where the auth gate bounced them from, if it did; re-checked against
      // the allowlist here so the form is safe wherever the value came from.
      window.location.assign(safeNextPath(next) ?? `/${userProfile.handle}`);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const showPasswordLabel = showPassword ? "Hide password" : "Show password";

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Log in</h1>
        <p className="text-sm text-muted-foreground">Use the email and password for this server.</p>
      </div>
      {passwordUpdated && (
        <p className="rounded-md border bg-muted/50 p-3 text-sm">
          Your password has been updated. Log in with the new one.
        </p>
      )}
      <form onSubmit={handleLogin}>
        <div className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              className="h-11 md:h-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/auth/forgot-password"
                tabIndex={-1}
                className="ml-auto inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="h-11 pr-12 md:h-9 md:pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPasswordLabel}
                    aria-pressed={showPassword}
                    className="absolute right-0 top-0 size-11 text-muted-foreground hover:text-foreground md:size-9"
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showPasswordLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {error && <p className="text-sm text-destructive-text">{error}</p>}
          <Button type="submit" className="h-11 w-full md:h-9" disabled={isLoading}>
            {isLoading ? "Logging in..." : "Log in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {signupState === "closed" ? (
              "New accounts are closed on this server."
            ) : (
              <>
                {signupState === "first" ? "No accounts here yet." : "Have an invite?"}{" "}
                <Link
                  href={signUpHref(invite)}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {signupState === "first" ? "Create the first account" : "Create an account"}
                </Link>
              </>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
