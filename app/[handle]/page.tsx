import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";
import CreateChannelButton from "@/components/create-channel-button";
import { ChannelsView } from "@/components/channels-view";
import { Channel, getUserChannels, getVisibleUserChannels } from "@/lib/colosseum/channel";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { getSessionUser } from "@/lib/auth";
import Link from "next/link";

// Grid-card border per access mode: private reads as "restricted" (red), open as
// "collaborative" (emerald), public as neutral.
const CHANNEL_CARD_CLASS = {
  private: "bg-red-500/5 border-red-500/50 hover:border-red-500",
  open: "bg-emerald-500/5 border-emerald-500/50 hover:border-emerald-500",
  public: "border-gray-500/50 hover:border-gray-500",
} as const;

async function ChannelColumnsView({
  channel,
  columnCount,
  viewerId,
}: {
  channel: Channel;
  columnCount: number;
  viewerId: string | null;
}) {
  // Only the first 5 previews are shown, so don't fetch the whole channel.
  const columns = await getChannelColumns(channel.id, { limit: 5 }, viewerId);

  return (
    <div className="flex flex-col md:flex-row gap-8 p-2">
      <div className="flex flex-col justify-center items-center space-y-1 w-full md:w-[250px] md:h-[250px] shrink-0">
        <h2 className="text-heading text-center">{channel.title}</h2>
        {channel.description ? (
          <p className="text-center line-clamp-3 break-words max-w-full">{channel.description}</p>
        ) : null}
        <p className="text-caption">{columnCount} column(s)</p>
      </div>
      <div className="hidden md:flex gap-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {columns.map((column, index) => (
          <div
            key={column.id}
            className={
              index >= 5
                ? "hidden"
                : "border-2 rounded-md w-[200px] h-[200px] sm:w-[250px] sm:h-[250px] shrink-0"
            }
          >
            <ColumnPreview column={column} />
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

  // One count per channel, fetched once and shared by the grid cards and the
  // list rows so the two views don't each re-query.
  const counts = await Promise.all(channels.map((c) => getChannelColumnCount(c.id)));
  const countById = new Map(channels.map((c, i) => [c.id, counts[i]]));

  // One grid card per channel, keyed by id, so the (client) ChannelsView can
  // pick which to render when filtering while the previews stay server-fetched.
  const gridCards = channels.map((channel) => ({
    id: channel.id,
    node: (
      <Link key={channel.id} href={`/${handle}/${channel.id}`}>
        <div
          className={`flex aspect-square items-center justify-center p-4 md:block md:aspect-auto md:p-8 border-2 rounded-lg transition-colors ${CHANNEL_CARD_CLASS[channel.access]}`}
        >
          <ChannelColumnsView
            channel={channel}
            columnCount={countById.get(channel.id) ?? 0}
            viewerId={user?.id ?? null}
          />
        </div>
      </Link>
    ),
  }));

  const channelRows = channels.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    private: c.private,
    created_at: c.created_at,
    count: countById.get(c.id) ?? 0,
  }));

  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: handle }]} />
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-label">About</h2>
          {userProfile.about ? <p className="">{userProfile.about}</p> : null}
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

      {channels.length === 0 ? (
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
