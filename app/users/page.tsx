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
    <div className="w-full flex-1 min-h-0 flex flex-col p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "invites", href: "/invites" }, { label: "users" }]} />
      <p className="text-sm text-muted-foreground max-w-prose">
        The invite network. Each line connects a member to someone they invited — larger nodes have
        invited more people. Search by handle, or hover, focus or tap a node to name it and trace
        its connections. A second tap — or a click — opens that member&apos;s profile.
      </p>
      <UserGraph graph={graph} />
    </div>
  );
}
