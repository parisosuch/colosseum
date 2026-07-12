import { LoginForm } from "@/components/login-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  // Carry a shared invite link's ?invite=CODE through to sign-up.
  const { invite } = await searchParams;
  return (
    <div className="flex flex-1 justify-center md:justify-start">
      <div className="w-full max-w-sm">
        <LoginForm invite={invite ?? ""} />
      </div>
    </div>
  );
}
