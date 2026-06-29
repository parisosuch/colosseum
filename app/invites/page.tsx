import { redirect } from "next/navigation";

import BrandLink from "@/components/brand-link";
import InviteManager from "@/components/invite-manager";
import { getMyInviteCodes } from "@/lib/colosseum/invite";
import { getUserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";

export default async function InvitesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // No profile yet — finish onboarding before handing out invites.
  const userProfile = await getUserProfile(supabase, user.id);
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  const codes = await getMyInviteCodes(supabase, user.id);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <h1 className="text-4xl">
        <BrandLink /> <span className="font-extralight">/</span> invites
      </h1>
      <p className="text-sm font-light text-muted-foreground max-w-prose">
        Colosseum is invite only. Share a code with someone you want to invite — each code is good
        for one sign-up.
      </p>
      <InviteManager userId={user.id} initialCodes={codes} />
    </div>
  );
}
