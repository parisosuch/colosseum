import { getSessionUser } from "@/lib/auth";
import { getUserChannels } from "@/lib/colosseum/channel";
import { getUserProfile } from "@/lib/colosseum/user";
import { MobileBottomBar } from "./mobile-bottom-bar";

// Server wrapper: fetches the session, profile, and channel list for the mobile
// bottom bar. Renders nothing for signed-out or not-yet-onboarded users (they
// have no profile and nowhere to add a block).
export default async function MobileBottomNav() {
  const user = await getSessionUser();
  if (!user) return null;

  const profile = await getUserProfile(user.id);
  if (!profile) return null;

  const channels = await getUserChannels(user.id);

  return (
    <MobileBottomBar
      userId={user.id}
      handle={profile.handle}
      avatarUrl={profile.avatar_url}
      channels={channels.map((c) => ({ id: c.id, title: c.title, private: c.private }))}
    />
  );
}
