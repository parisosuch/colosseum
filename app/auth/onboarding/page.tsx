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

  // Same slot classes as login and sign-up: onboarding renders inside the hero
  // frame, which supplies the padding and centering itself, so the panel lands
  // where the step before it did instead of shifting mid-flow.
  return (
    <div className="flex flex-1 justify-center md:justify-start">
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </div>
  );
}
