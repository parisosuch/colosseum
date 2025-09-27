import {
  getUserChannels,
  getUserPublicChannels,
} from "@/lib/colosseum/channel";
import { createClient } from "@/lib/supabase/server";
import { Channel } from "@/lib/colosseum/channel";
import CreateChannelButton from "@/components/create-channel-button";
import {
  getChannelColumnCount,
  getChannelColumns,
} from "@/lib/colosseum/column";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import Link from "next/link";
import ColumnPreview from "@/components/column-preview";

type PageProps = {
  params: { handle: string };
};

export default async function UserPage({ params }: PageProps) {
  const { handle } = await params;

  const supabase = await createClient();

  const ChannelColumnsView = async ({ channel }: { channel: Channel }) => {
    const columns = await getChannelColumns(supabase, channel.id, 4);

    const columnCount = await getChannelColumnCount(supabase, channel.id);

    return (
      <div className="flex gap-8 p-2">
        <div className="flex flex-col justify-center items-center space-y-1 w-[250px] h-[250px]">
          <h2 className="text-lg">{channel.title}</h2>
          {channel.description ? (
            <p className="text-center">{channel.description}</p>
          ) : null}
          <p className="text-sm dark:text-white/75 text-black/75 font-light">
            {columnCount} column(s)
          </p>
        </div>
        <div className="flex gap-8 overflow-x-auto">
          {columns.map((column) => (
            <div
              key={column.id}
              className="border-2 rounded-md w-[250px] h-[250px]"
            >
              <ColumnPreview column={column} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const OwnerView = ({ channels }: { channels: Channel[] }) => {
    if (channels.length === 0) {
      return (
        <div className="w-full flex items-center justify-center">
          <div className="w-1/2 flex space-x-4 items-center">
            <h1 className="text-4xl font-semibold">
              Looks like you have no channels.
            </h1>
            <CreateChannelButton />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <CreateChannelButton />
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

  const VisitorView = ({ channels }: { channels: Channel[] }) => {
    if (channels.length === 0) {
      return (
        <div className="w-full flex items-center justify-center">
          <h1 className="text-4xl font-semibold">
            User has no public channels.
          </h1>
        </div>
      );
    }
    return <p>User has some public channels.</p>;
  };

  // determine if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userProfile = await getPublicUserProfile(supabase, handle);

  if (!userProfile) {
    return (
      <div className="w-full flex items-center justify-center">
        <h1 className="text-4xl font-semibold">This user does not exist!</h1>
      </div>
    );
  }
  if (!user) {
    const channels = await getUserPublicChannels(
      supabase,
      userProfile?.user_id
    );

    return (
      <div className="w-full">
        <VisitorView channels={channels} />
      </div>
    );
  }

  const match = userProfile?.user_id === user!.id;

  if (match) {
    const channels = await getUserChannels(supabase, user.id);

    return (
      <div className="w-full p-12 space-y-8">
        <h1 className="text-4xl">
          <Link
            href="/"
            className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
          >
            Colloseum
          </Link>{" "}
          <span className="font-extralight">/</span> {handle}
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

        <OwnerView channels={channels} />
      </div>
    );
  }

  // else all, get public channels and show visitor view for authenticated user
  const channels = await getUserPublicChannels(supabase, userProfile.user_id);

  return (
    <div className="w-full">
      <VisitorView channels={channels} />
    </div>
  );
}
