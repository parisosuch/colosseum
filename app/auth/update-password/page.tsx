import Link from "next/link";

import { UpdatePasswordForm } from "@/components/update-password-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkPasswordResetToken } from "@/lib/colosseum/password-reset";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  // The reset link goes to Better Auth first, which forwards here with either
  // the one-time token or ?error=INVALID_TOKEN when the link is already dead.
  // Checking the token here rather than at submit costs a stale link a click
  // instead of a chosen password.
  const { token, error } = await searchParams;
  const state = error ? "invalid" : await checkPasswordResetToken(token ?? "");

  return (
    <div className="flex flex-1 w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {state === "invalid" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-title">This link has expired</CardTitle>
              <CardDescription>Reset links work once, and not for long.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Ask for a new one and it will be on its way in a moment.
              </p>
              <Link
                href="/auth/forgot-password"
                className={buttonVariants({ className: "w-full" })}
              >
                Send a new link
              </Link>
              <p className="text-center text-sm">
                Remembered it?{" "}
                <Link href="/auth/login" className="underline underline-offset-4">
                  Login
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <UpdatePasswordForm token={token ?? ""} />
        )}
      </div>
    </div>
  );
}
