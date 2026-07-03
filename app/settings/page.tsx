import PageHeader from "@/components/page-header";
import { EditProfileForm } from "@/components/edit-profile-form";
import ApiTokenManager from "@/components/api-token-manager";
import { getUserProfile } from "@/lib/colosseum/user";
import { getMyApiTokens } from "@/lib/colosseum/api-token";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    </div>
  );
}
