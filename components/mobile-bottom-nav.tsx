import { getSessionUser } from "@/lib/auth";
import { getUserChannels } from "@/lib/colosseum/channel";
import { unreadNotificationCount } from "@/lib/colosseum/notification";
import { getUserProfile } from "@/lib/colosseum/user";
import { MobileBottomBar } from "./mobile-bottom-bar";

// Server wrapper: fetches the session, profile, channel list, and unread count
// for the mobile bottom bar. Renders nothing for signed-out or not-yet-onboarded
// users (they have no profile and nowhere to add a block).
export default async function MobileBottomNav() {
  const user = await getSessionUser();
  if (!user) return null;

  const profile = await getUserProfile(user.id);
  if (!profile) return null;

  // Neither needs the other, and this renders in the root layout, so
  // serializing them adds latency to every route.
  const [channels, unread] = await Promise.all([
    getUserChannels(user.id),
    unreadNotificationCount(user.id),
  ]);

  return (
    <MobileBottomBar
      handle={profile.handle}
      avatarUrl={profile.avatar_url}
      isAdmin={user.is_admin}
      channels={channels.map((c) => ({ id: c.id, title: c.title, private: c.private }))}
      unread={unread}
    />
  );
}
