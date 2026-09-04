import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/next-path";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; next?: string; reset?: string }>;
}) {
  // Carry a shared invite link's ?invite=CODE through to sign-up. ?next= is
  // where the auth gate bounced them from, filtered through the allowlist here
  // so the form is only ever handed a destination we already trust. ?reset=1
  // means they just set a new password and have to use it once.
  const { invite, next, reset } = await searchParams;
  return (
    <div className="flex flex-1 justify-center md:justify-start">
      <div className="w-full max-w-sm">
        <LoginForm
          invite={invite ?? ""}
          next={safeNextPath(next) ?? ""}
          passwordUpdated={reset === "1"}
        />
      </div>
    </div>
  );
}
