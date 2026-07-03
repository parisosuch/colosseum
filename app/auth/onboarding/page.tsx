import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { getUserProfile } from "@/lib/colosseum/user";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Already onboarded — send them to their profile.
  const userProfile = await getUserProfile(user.id);
  if (userProfile) {
    redirect(`/${userProfile.handle}`);
  }

  return (
    <div className="flex flex-1 w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </div>
  );
}
