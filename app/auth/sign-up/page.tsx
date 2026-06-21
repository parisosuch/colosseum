import Link from "next/link";

import { SignUpForm } from "@/components/sign-up-form";
import { signupsDisabled } from "@/lib/colosseum/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {signupsDisabled() ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Sign-ups are closed</CardTitle>
              <CardDescription>
                New account registration is currently disabled. If you already have an account, you
                can{" "}
                <Link href="/auth/login" className="underline underline-offset-4">
                  log in
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ) : (
          <SignUpForm />
        )}
      </div>
    </div>
  );
}
