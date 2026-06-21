import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/colosseum/user";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Already onboarded — send them to their profile.
  const userProfile = await getUserProfile(supabase, user.id);
  if (userProfile) {
    redirect(`/${userProfile.handle}`);
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </div>
  );
}
