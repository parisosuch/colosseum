import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";
import CreateChannelButton from "@/components/create-channel-button";
import { ChannelsView } from "@/components/channels-view";
import {
  Channel,
  getMemberChannels,
  getUserChannels,
  getVisibleUserChannels,
} from "@/lib/colosseum/channel";
import { Column, getChannelColumnCounts, getTopColumnsByChannel } from "@/lib/colosseum/column";
import { getScreenshotsForUrls, type ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { getSessionUser } from "@/lib/auth";
import Link from "next/link";
import { UserProfilePicture } from "@/components/user-profile-picture";
import { Badge } from "@/components/ui/badge";

// How many block previews each channel card shows.
const PREVIEWS_PER_CHANNEL = 5;

// Grid-card border per access mode: private reads as "restricted" (red), open as
// "collaborative" (emerald), public as neutral.
const CHANNEL_CARD_CLASS = {
  private: "bg-red-500/5 border-red-500/50 hover:border-red-500",
  open: "bg-emerald-500/5 border-emerald-500/50 hover:border-emerald-500",
  public: "border-gray-500/50 hover:border-gray-500",
} as const;

// Previews are fetched once for the whole page (batched) and passed in, so this
// is a plain sync component — no per-card query.
function ChannelColumnsView({
  channel,
  columnCount,
  columns,
  screenshots,
  memberOf,
}: {
  channel: Channel;
  columnCount: number;
  columns: Column[];
  screenshots: Map<string, ColumnScreenshot>;
  memberOf?: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-8 p-2">
      <div className="flex flex-col justify-center items-center space-y-1 w-full md:w-[250px] md:h-[250px] shrink-0">
        <h2 className="text-heading text-center">{channel.title}</h2>
        {channel.description ? (
          <p className="text-center line-clamp-3 break-words max-w-full">{channel.description}</p>
        ) : null}
        <p className="text-caption">{columnCount} column(s)</p>
        {memberOf ? (
          <Badge variant="secondary" className="font-normal">
            member of
          </Badge>
        ) : null}
      </div>
      <div className="hidden md:flex gap-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {columns.map((column) => (
          <div
            key={column.id}
            className="border-2 rounded-md w-[200px] h-[200px] sm:w-[250px] sm:h-[250px] shrink-0"
          >
            <ColumnPreview
              column={column}
              screenshot={column.url ? (screenshots.get(column.url) ?? null) : null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function UserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  // determine if user is authenticated
  const user = await getSessionUser();

  const userProfile = await getPublicUserProfile(handle);

  if (!userProfile) {
    return (
      <div className="w-full p-12 space-y-2">
        <PageHeader crumbs={[{ label: handle }]} />
        <p className="text-muted-foreground">No one here.</p>
      </div>
    );
  }

  const match = !!user && userProfile.user_id === user.id;

  // On your own profile you see all your channels; on someone else's you see
  // their public/open channels plus any private group you've been invited to.
  const channels: Channel[] = match
    ? await getUserChannels(user!.id)
    : await getVisibleUserChannels(userProfile.user_id, user?.id ?? null);

  // Only on your own profile: the channels you've been invited to (not owned).
  // They render in the same grid as your own, carrying the owner's handle (for
  // the link) and a "Member of" badge. Owned channels come first.
  const memberChannels = match ? await getMemberChannels(user!.id) : [];
  const entries = [
    ...channels.map((channel) => ({ channel, handle, memberOf: false })),
    ...memberChannels.map((channel) => ({ channel, handle: channel.handle, memberOf: true })),
  ];

  // Counts and previews for every channel in one query each (not one per
  // channel): a grouped count(*) and a single windowed top-N fetch. Counts are
  // shared by the grid cards and the list rows so the two views don't re-query.
  const channelIds = entries.map((e) => e.channel.id);
  const [countById, previewsById] = await Promise.all([
    getChannelColumnCounts(channelIds),
    getTopColumnsByChannel(channelIds, PREVIEWS_PER_CHANNEL, user?.id ?? null),
  ]);

  // One batched screenshot lookup for every url block across all the previews,
  // rather than each ColumnPreview querying on its own.
  const previewUrls = [...previewsById.values()]
    .flat()
    .filter((c) => c.type === "url" && c.url)
    .map((c) => c.url!);
  const screenshots = await getScreenshotsForUrls(previewUrls);

  // One grid card per channel, keyed by id, so the (client) ChannelsView can
  // pick which to render when filtering while the previews stay server-fetched.
  const gridCards = entries.map(({ channel, handle: ownerHandle, memberOf }) => ({
    id: channel.id,
    node: (
      <Link key={channel.id} href={`/${ownerHandle}/${channel.id}`}>
        <div
          className={`flex aspect-square items-center justify-center p-4 md:block md:aspect-auto md:p-8 border-2 rounded-lg transition-colors ${CHANNEL_CARD_CLASS[channel.access]}`}
        >
          <ChannelColumnsView
            channel={channel}
            columnCount={countById.get(channel.id) ?? 0}
            columns={previewsById.get(channel.id) ?? []}
            screenshots={screenshots}
            memberOf={memberOf}
          />
        </div>
      </Link>
    ),
  }));

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
