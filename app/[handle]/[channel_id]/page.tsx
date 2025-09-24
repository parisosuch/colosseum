import { getChannel } from "@/lib/colosseum/channel";
import { getChannelColumns } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type PageProps = {
  params: {
    handle: string;
    channel_id: number;
  };
};

export default async function ChannelPage({ params }: PageProps) {
  const { handle, channel_id } = await params;

  const supabase = await createClient();

  // get channel information
  const channel = await getChannel(supabase, channel_id);

  // redirect user if the channel is private and owner is not user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && channel.private) {
    redirect("/");
  }

  if (user!.id !== channel.owner_id && channel.private) {
    redirect("/");
  }

  // get channel columns and extract necessary metadata
  const columns = await getChannelColumns(supabase, channel_id);

  const lastModifiedChannel = columns.at(0);

  let lastModifiedChannelDays: string;

  if (!lastModifiedChannel) {
    lastModifiedChannelDays = "Never";
  } else {
    const today = new Date();
    const lastDate = new Date(lastModifiedChannel.created_at);

    const diffInMs = today.getTime() - lastDate.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays == 0) {
      lastModifiedChannelDays = "Today";
    } else {
      lastModifiedChannelDays = `${diffInDays} days ago`;
    }
  }

  return (
    <div className="w-full p-12 space-y-8">
      <h1 className="text-4xl">
        Colloseum / {handle} / {channel.title}
      </h1>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Description</h2>
          {channel.description ? (
            <p className="">{channel.description}</p>
          ) : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Meta</h2>
          <div className="flex space-x-2">
            <h3>Created On</h3>
            <p>
              {new Date(channel.created_at).toLocaleString("default", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="flex space-x-2">
            <h3>Last Modified</h3>
            <p>{lastModifiedChannelDays}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
