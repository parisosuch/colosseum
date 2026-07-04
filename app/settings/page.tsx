import Link from "next/link";

import PageHeader from "@/components/page-header";
import { EditProfileForm } from "@/components/edit-profile-form";
import ApiTokenManager from "@/components/api-token-manager";
import { getUserProfile } from "@/lib/colosseum/user";
import { getMyApiTokens } from "@/lib/colosseum/api-token";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getUserProfile(user.id);

  if (!profile) {
    redirect("/auth/onboarding");
  }

  const apiTokens = await getMyApiTokens(user.id);

  return (
    <div className="w-full max-w-xl p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "settings" }]} />
      <EditProfileForm profile={profile} />
      <ApiTokenManager userId={user.id} initialTokens={apiTokens} />
      <Link
        href="/changelog"
        className="text-sm text-muted-foreground underline hover:text-foreground"
      >
        Changelog
      </Link>
    </div>
  );
}
