import { redirect } from "next/navigation";

import ChannelBoard from "@/components/channel-board";
import { getChannel } from "@/lib/colosseum/channel";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/server";

type ChannelPageParams = {
  params: Promise<{ handle: string; channel_id: string }>;
};

export default async function ChannelPage({ params }: ChannelPageParams) {
  const { handle, channel_id } = await params;
  const id = parseInt(channel_id, 10);
  if (Number.isNaN(id)) redirect("/");

  const supabase = await createClient();

  // null = the channel doesn't exist or RLS hides it from this user (e.g. a
  // private channel they don't own). Don't leak which; redirect.
  const channel = await getChannel(supabase, id);
  if (!channel) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (channel.private && (!user || user.id !== channel.owner_id)) redirect("/");

  const isOwner = !!user && channel.owner_id === user.id;

  // Cheap channel-wide stats so the shell (breadcrumb + meta) is accurate at
  // first paint. The block grid is fetched client-side with skeletons.
  const [totalCount, newest] = await Promise.all([
    getChannelColumnCount(supabase, id),
    getChannelColumns(supabase, id, { sort: "newest", limit: 1 }),
  ]);

  const createdOnLabel = new Date(channel.created_at).toLocaleString("default", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <ChannelBoard
      channel={channel}
      handle={handle}
      isOwner={isOwner}
      user={user}
      initialCount={totalCount}
      newestAt={newest[0]?.created_at ?? null}
      createdOnLabel={createdOnLabel}
    />
  );
}
