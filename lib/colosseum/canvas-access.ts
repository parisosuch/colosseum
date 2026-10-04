import { canContributeChannel, canReadChannel, getChannel, resolveChannelViewer } from "./channel";
import { getUserProfile } from "./user";

// What a viewer may do on a channel's canvas, and who they appear as there.
// The realtime authorize route answers with this, at connect time and again
// whenever a permission change re-checks an open socket.
export type CanvasAuthorization = {
  // Contributors write; anyone else who can read the channel gets read-only.
  access: "read" | "write";
  userId: string | null;
  // The editor's presence identity. Null for read access, which never shows
  // up in presence, and for an editor who hasn't picked a handle yet.
  handle: string | null;
  avatarUrl: string | null;
};

// The channel page's rule, for a resolved session user id (null when signed
// out or banned; getSessionUser already folds a ban into that). Null when the
// channel doesn't exist or the viewer can't read it, without saying which.
export async function canvasAuthorization(
  channelId: number,
  userId: string | null,
): Promise<CanvasAuthorization | null> {
  const channel = await getChannel(channelId);
  if (!channel) return null;
  const viewer = await resolveChannelViewer(channel, userId);
  if (!canReadChannel(channel, viewer)) return null;
  if (!userId || !canContributeChannel(channel, viewer)) {
    return { access: "read", userId, handle: null, avatarUrl: null };
  }
  const profile = await getUserProfile(userId);
  return {
    access: "write",
    userId,
    handle: profile?.handle ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}
