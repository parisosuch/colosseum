"use client";

import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UpdatePasswordForm({
  className,
  token,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // The one-time token off the reset link, checked before this page
      // rendered; Better Auth verifies it again here and sets the password.
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) throw new Error(error.message ?? "Could not update the password.");
      // Resetting a password doesn't start a session, so the app root would put
      // them back on the signed-out hero with nothing to say the reset worked.
      // Login says it, and the new password gets used once straight away.
      router.push("/auth/login?reset=1");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-title">Reset Your Password</CardTitle>
          <CardDescription>Please enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="New password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save new password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
