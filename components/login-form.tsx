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
import { getMyProfileAction } from "@/lib/colosseum/actions";
import { safeNextPath } from "@/lib/next-path";

export function LoginForm({
  className,
  invite = "",
  next = "",
  passwordUpdated = false,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  invite?: string;
  next?: string;
  passwordUpdated?: boolean;
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

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2">
        <Logo className="h-4 w-auto text-muted-foreground opacity-25" />
        <h1 className="text-title">Login</h1>
        <p className="text-muted-foreground">Enter your email below to login to your account</p>
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
              placeholder="m@example.com"
              required
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
                className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
              >
                Forgot your password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Logging in..." : "Login"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={invite ? `/auth/sign-up?invite=${encodeURIComponent(invite)}` : "/auth/sign-up"}
              className="underline underline-offset-4"
            >
              Create account
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
