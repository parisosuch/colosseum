import BrandLink from "@/components/brand-link";
import { EditProfileForm } from "@/components/edit-profile-form";
import { getUserProfile } from "@/lib/colosseum/user";
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

  const profile = await getUserProfile(supabase, user.id);

  if (!profile) {
    redirect("/auth/onboarding");
  }

  return (
    <div className="w-full p-12 space-y-8">
      <h1 className="text-4xl">
        <BrandLink /> <span className="font-extralight">/ settings</span>
      </h1>
      <EditProfileForm profile={profile} />
    </div>
  );
}
