"use server";

import type { ReactNode } from "react";

import { ACTIVITY_PAGE, getActivityFeed, groupActivity } from "@/lib/colosseum/activity";
import { getSessionUser } from "@/lib/auth";
import { ActivityRow, activityKey } from "@/components/explore-view";

// Load-more for the Explore feed: fetches the next page (older than `before`)
// and returns it already rendered as server components, so URL screenshots and
// other server-only previews render exactly like the initial page. Public
// content only — the same filtering as getActivityFeed applies.
export async function loadMoreActivity(
  before: string,
): Promise<{ rows: ReactNode; nextCursor: string | null; hasMore: boolean }> {
  const user = await getSessionUser();
  const viewerId = user?.id ?? null;
  const items = await getActivityFeed(viewerId, ACTIVITY_PAGE, before);
  return {
    rows: groupActivity(items).map((group) => (
      <ActivityRow key={activityKey(group[0])} group={group} viewerId={viewerId} />
    )),
    nextCursor: items.length > 0 ? items[items.length - 1].at : null,
    hasMore: items.length === ACTIVITY_PAGE,
  };
}
