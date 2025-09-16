import {
  getUserChannels,
  getUserPublicChannels,
} from "@/lib/colosseum/channel";
import { createClient } from "@/lib/supabase/server";
import { Channel } from "@/lib/colosseum/channel";
import CreateChannelButton from "@/components/create-channel-button";

type PageProps = {
  params: { handle: string };
};

export default async function UserPage({ params }: PageProps) {
  const { handle } = await params;

  const supabase = await createClient();

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
      <div className="p-4">
        {channels.map((channel) => (
          <div className="border-2 border-gray-500/50 rounded-lg p-8 flex flex-row items-center space-x-8">
            <div className="flex flex-col items-center">
              <h2 className="text-lg">{channel.title}</h2>
              {channel.description ? <p>{channel.description}</p> : null}
            </div>
            <div>
              <p>this is where columns go</p>
            </div>
          </div>
        ))}
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

  const { data, error } = await supabase
    .from("user_profile")
    .select("user_id")
    .eq("handle", handle)
    .single();

  if (error) {
    console.error(error);
  }

  if (!data) {
    return (
      <div className="w-full flex items-center justify-center">
        <h1 className="text-4xl font-semibold">This user does not exist!</h1>
      </div>
    );
  }
  if (!user) {
    const channels = await getUserPublicChannels(supabase, data?.user_id);

    return (
      <div className="w-full">
        <VisitorView channels={channels} />
      </div>
    );
  }

  const match = data?.user_id === user!.id;

  if (match) {
    const channels = await getUserChannels(supabase, user.id);

    return (
      <div className="w-full">
        <OwnerView channels={channels} />
      </div>
    );
  }

  // else all, get public channels and show visitor view for authenticated user
  const channels = await getUserPublicChannels(supabase, data.user_id);

  return (
    <div className="w-full">
      <VisitorView channels={channels} />
    </div>
  );
}
