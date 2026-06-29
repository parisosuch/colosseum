import BrandLink from "@/components/brand-link";
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
    const columns = await getChannelColumns(supabase, channel.id);

    const columnCount = await getChannelColumnCount(supabase, channel.id);

    return (
      <div className="flex gap-8 p-2">
        <div className="flex flex-col justify-center items-center space-y-1 w-[250px] h-[250px]">
          <h2 className="text-lg">{channel.title}</h2>
          {channel.description ? <p className="text-center">{channel.description}</p> : null}
          <p className="text-sm dark:text-white/75 text-black/75 font-light">
            {columnCount} column(s)
          </p>
        </div>
        <div className="flex gap-8 overflow-x-auto">
          {columns.map((column, index) => (
            <div
              key={column.id}
              className={index >= 5 ? "md:hidden" : "border-2 rounded-md w-[250px] h-[250px]"}
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
            <h1 className="text-4xl font-semibold">
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
        <div className="flex flex-col space-y-4">
          {channels.map((channel) => (
            <Link key={channel.id} href={`/${handle}/${channel.id}`}>
              <div className="border-2 border-gray-500/50 rounded-lg p-8">
                <ChannelColumnsView channel={channel}></ChannelColumnsView>
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
    // TODO: make this prettier
    return (
      <div className="w-full flex items-center justify-center">
        <h1 className="text-4xl font-semibold">This user does not exist!</h1>
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
    <div className="w-full p-12 space-y-8">
      <h1 className="text-4xl">
        <BrandLink /> <span className="font-extralight">/</span> {handle}
      </h1>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">About</h2>
          {userProfile.about ? <p className="">{userProfile.about}</p> : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Joined</h2>
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
