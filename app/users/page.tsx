import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import UserGraph from "@/components/user-graph";
import { getInviteGraph } from "@/lib/colosseum/invite";
import { getUserProfile } from "@/lib/colosseum/user";
import { getSessionUser } from "@/lib/auth";

// The invite network: members as nodes, "invited" as directed edges. Lives
// behind the same login+onboarding gate as /invites, which is where it's
// currently linked from.
export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }

  const userProfile = await getUserProfile(user.id);
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  const graph = await getInviteGraph();

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "invites", href: "/invites" }, { label: "users" }]} />
      <p className="text-sm text-muted-foreground max-w-prose">
        The invite network. Each arrow points from a member to someone they invited — larger nodes
        have invited more people. Click a member to visit their profile.
      </p>
      <UserGraph graph={graph} />
    </div>
  );
}
