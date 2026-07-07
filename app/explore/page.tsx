import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { getUserProfile } from "@/lib/colosseum/user";
import { getActivityFeed } from "@/lib/colosseum/activity";
import ExploreView from "@/components/explore-view";

// Explore lives on its own route (not `/`) so it renders inside the normal app
// chrome — nav, mobile bottom bar — rather than the full-bleed hero layout that
// `/` uses for the signed-out landing.
export default async function ExplorePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const profile = await getUserProfile(user.id);
  if (!profile) redirect("/auth/onboarding");

  const activity = await getActivityFeed();
  return <ExploreView activity={activity} />;
}
