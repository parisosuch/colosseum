import Link from "next/link";
import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import InviteManager from "@/components/invite-manager";
import { getMyInviteCodes } from "@/lib/colosseum/invite";
import { getUserProfile } from "@/lib/colosseum/user";
import { getSessionUser } from "@/lib/auth";

export default async function InvitesPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/auth/login");
  }

  // No profile yet — finish onboarding before handing out invites.
  const userProfile = await getUserProfile(user.id);
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  const codes = await getMyInviteCodes(user.id);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "invites" }]} />
      <p className="text-sm text-muted-foreground max-w-prose">
        Colosseum is invite only. Share a code with someone you want to invite — each code is good
        for one sign-up.{" "}
        <Link href="/users" className="link-subtle underline">
          See the invite network
        </Link>
        .
      </p>
      <InviteManager userId={user.id} initialCodes={codes} />
    </div>
  );
}
