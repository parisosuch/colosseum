import { getChannel } from "@/lib/colosseum/channel";
import { getChannelColumns } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
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
    lastModifiedChannelDays = "-";
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

  const MetaData = [
    {
      title: "Created On",
      data: new Date(channel.created_at).toLocaleString("default", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    },
    {
      title: "Last Modfified",
      data: lastModifiedChannelDays,
    },
    {
      title: "Length",
      data: columns.length.toString(),
    },
  ];

  return (
    <div className="w-full p-12 space-y-8">
      <h1 className="text-4xl">
        <Link href="/" className="hover:dark:text-white/75 hover:text-black/75">
          Colloseum
        </Link>{" "}
        /{" "}
        <Link
          href={`/${handle}`}
          className="hover:dark:text-white/75 hover:text-black/75"
        >
          {handle}
        </Link>{" "}
        / {channel.title}
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
          {MetaData.map((meta, index) => (
            // TODO: change the width to be responsive and appropriate for each screen size.
            <div key={index} className="flex w-[350px] justify-between">
              <h3>{meta.title}</h3>
              <p>{meta.data}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
