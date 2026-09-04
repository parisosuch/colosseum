import Link from "next/link";
import { UserX } from "lucide-react";

import PageHeader from "@/components/page-header";
import CreateChannelButton from "@/components/create-channel-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { buildChannelCards } from "@/components/channel-card";
import { CHANNELS_PAGE } from "@/components/channel-filter";
import { ChannelsView } from "@/components/channels-view";
import { getProfileChannels } from "@/lib/colosseum/channel";
import { getChannelColumnCounts } from "@/lib/colosseum/column";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { getSessionUser } from "@/lib/auth";
import { UserProfilePicture } from "@/components/user-profile-picture";

export default async function UserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  // The profile is keyed by the route's handle, not by the viewer, so the
  // session lookup and the profile lookup don't depend on each other.
  const [user, userProfile] = await Promise.all([getSessionUser(), getPublicUserProfile(handle)]);

  if (!userProfile) {
    return (
      <div className="w-full p-12 space-y-8">
        <PageHeader crumbs={[{ label: handle }]} />
        <EmptyState
          icon={UserX}
          title={`No one goes by @${handle}`}
          description="The handle may have changed, or the account may be gone."
        >
          <Button asChild variant="secondary">
            <Link href="/explore">Explore</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  const match = !!user && userProfile.user_id === user.id;

  // Owned channels (as this viewer may see them) followed by the ones you've
  // been invited to. Metadata only — a row per channel, which is what the
  // search box, the filters, the sorts and the list view all read.
  const entries = await getProfileChannels(userProfile.user_id, handle, user?.id ?? null);

  // Column counts for every channel: one grouped count(*), shared by the grid
  // cards and the list rows so the two views don't re-query, and needed in full
  // because "Column count" is one of the sorts.
  const countById = await getChannelColumnCounts(entries.map((e) => e.channel.id));

  // Only the first page gets cards. Previews are five blocks per channel plus a
  // batched screenshot lookup across every url block in them, so building them
  // for a whole collection is what makes a well-used profile slow to paint. The
  // client asks loadChannelCards for the rest as the reader scrolls.
  const gridCards = await buildChannelCards(
    entries.slice(0, CHANNELS_PAGE),
    user?.id ?? null,
    countById,
    true,
  );

  const channelRows = entries.map(({ channel: c, handle: ownerHandle, memberOf }) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    access: c.access,
    private: c.private,
    created_at: c.created_at,
    count: countById.get(c.id) ?? 0,
    handle: ownerHandle,
    memberOf,
  }));

  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: handle }]} />
      <div className="flex flex-col space-y-4">
        <div>
          <UserProfilePicture
            avatarUrl={userProfile.avatar_url}
            handle={userProfile.handle}
            size="xl"
          />
        </div>
        <div className="flex flex-col">
          {userProfile.about ? (
            <>
              <h2 className="text-label">About</h2>
              <p className="">{userProfile.about}</p>
            </>
          ) : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-label">Joined</h2>
          <p>
            {new Date(userProfile.created_at).toLocaleString("default", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="w-full flex items-center justify-center">
          <div className="w-1/2 flex flex-col space-y-4 items-center">
            <h1 className="text-display">Looks like {match ? "you" : "they"} have no channels.</h1>
            {match ? <CreateChannelButton /> : null}
          </div>
        </div>
      ) : (
        <ChannelsView
          isOwner={match}
          handle={handle}
          gridCards={gridCards}
          channels={channelRows}
        />
      )}
    </div>
  );
}
