import { getChannel } from "@/lib/colosseum/channel";
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
          <h2 className="text-sm font-light">Created on</h2>
          <p>
            {new Date(channel.created_at).toLocaleString("default", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
