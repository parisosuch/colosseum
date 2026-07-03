import PageHeader from "@/components/page-header";
import ColumnPreview from "@/components/column-preview";
import CreateChannelButton from "@/components/create-channel-button";
import { Channel, getUserChannels, getUserPublicChannels } from "@/lib/colosseum/channel";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function UserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  const supabase = await createClient();

  const ChannelColumnsView = async ({ channel }: { channel: Channel }) => {
    // Only the first 5 previews are shown, so don't fetch the whole channel.
    const columns = await getChannelColumns(supabase, channel.id, { limit: 5 });

    const columnCount = await getChannelColumnCount(supabase, channel.id);

    return (
      <div className="flex flex-col md:flex-row gap-8 p-2">
        <div className="flex flex-col justify-center items-center space-y-1 w-full md:w-[250px] md:h-[250px] shrink-0">
          <h2 className="text-heading">{channel.title}</h2>
          {channel.description ? <p className="text-center">{channel.description}</p> : null}
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
  };

  const ChannelsView = ({ channels, isOwner }: { channels: Channel[]; isOwner: boolean }) => {
    if (channels.length === 0) {
      return (
        <div className="w-full flex items-center justify-center">
          <div className="w-1/2 flex space-x-4 items-center">
            <h1 className="text-display">
              Looks like {isOwner ? "you" : "they"} have no channels.
            </h1>
            {isOwner ? <CreateChannelButton /> : null}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {isOwner ? <CreateChannelButton /> : null}
        <div className="grid grid-cols-1 gap-4 md:flex md:flex-col md:space-y-4 md:gap-0">
          {channels.map((channel) => (
            <Link key={channel.id} href={`/${handle}/${channel.id}`}>
              <div
                className={`flex aspect-square items-center justify-center p-4 md:block md:aspect-auto md:p-8 border-2 rounded-lg transition-colors ${channel.private ? "bg-red-500/5 border-red-500/50 hover:border-red-500" : "border-gray-500/50 hover:border-gray-500"}`}
              >
                <ChannelColumnsView channel={channel} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  };

  // determine if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userProfile = await getPublicUserProfile(supabase, handle);

  if (!userProfile) {
    return (
      <div className="w-full p-12 space-y-2">
        <PageHeader crumbs={[{ label: handle }]} />
        <p className="text-muted-foreground">No one here.</p>
      </div>
    );
  }

  let match: boolean;
  if (!user) {
    match = false;
  } else {
    match = userProfile?.user_id === user.id;
  }

  let channels: Channel[];

  if (!match) {
    channels = await getUserPublicChannels(supabase, userProfile.user_id);
  } else {
    channels = await getUserChannels(supabase, user!.id);
  }

  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto p-6 sm:p-12 space-y-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      <ChannelsView channels={channels} isOwner={match} />
    </div>
  );
}
