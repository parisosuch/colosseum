"use client";

import ColumnComponent from "@/components/column";
import ColumnInput from "@/components/column-input";
import { Channel, getChannel } from "@/lib/colosseum/channel";
import { Column, getChannelColumns } from "@/lib/colosseum/column";
import { ColumnScreenshot, getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ChannelPage() {
  const params = useParams();
  const handle = params.handle as string;
  const channel_id = params.channel_id as string;

  const [channel, setChannel] = useState<Channel | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(new Map());
  const [user, setUser] = useState<User | null>(null);
  const [metaData, setMetaData] = useState<{ title: string; data: string }[]>();
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const handleMetaData = (channelData: Channel, columnsData: Column[]) => {
    const lastModifiedChannel = columnsData.at(0);
    let lastModifiedChannelDays: string;
    if (!lastModifiedChannel) {
      lastModifiedChannelDays = "-";
    } else {
      const today = new Date();
      const lastDate = new Date(lastModifiedChannel.created_at);
      const diffInMs = today.getTime() - lastDate.getTime();
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
      lastModifiedChannelDays = diffInDays === 0 ? "Today" : `${diffInDays} days ago`;
    }

    setMetaData([
      {
        title: "Created On",
        data: new Date(channelData.created_at).toLocaleString("default", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      },
      {
        title: "Last Modified",
        data: lastModifiedChannelDays,
      },
      {
        title: "Length",
        data: columnsData.length.toString(),
      },
    ]);
  };

  const fetchData = async () => {
    setLoading(true);

    try {
      const channelResponse = await getChannel(supabase, parseInt(channel_id, 10));
      if (!channelResponse) {
        // null = the channel doesn't exist or RLS hides it from this user
        // (e.g. a private channel they don't own). Don't leak which; redirect.
        router.push("/");
        return;
      }
      setChannel(channelResponse);

      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData.user;

      const match = !currentUser ? false : channelResponse.owner_id === currentUser.id;

      setIsOwner(match);

      if (channelResponse.private) {
        if (!currentUser || currentUser.id !== channelResponse.owner_id) {
          router.push("/"); // redirect safely in client component
          return;
        }
      }

      setUser(currentUser);

      const columnsResponse = await getChannelColumns(supabase, parseInt(channel_id, 10));
      setColumns(columnsResponse);

      handleMetaData(channelResponse, columnsResponse);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!channel_id) {
      return;
    }

    fetchData();
  }, [channel_id, supabase, router]);

  // Hydrate screenshots for all URL columns in a single batched query instead
  // of each ColumnComponent fetching its own. Runs on load and whenever a new
  // URL column appears (only the missing ones are fetched).
  useEffect(() => {
    const missing = columns
      .filter((c) => c.type === "url" && c.url && !screenshots.has(c.url))
      .map((c) => c.url!);

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fetched = await getScreenshotsForUrls(supabase, missing);
        if (cancelled) return;
        setScreenshots((prev) => {
          const next = new Map(prev);
          // Record every requested URL so a missing screenshot resolves to a
          // null image (and isn't refetched on the next render).
          for (const url of missing) {
            next.set(url, fetched.get(url) ?? { url, image_url: null, title: null });
          }
          return next;
        });
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columns, screenshots, supabase]);

  // `channel` stays null while a redirect (not-found / RLS-hidden) is in
  // flight, so guard on it too — `loading` is already false by then.
  if (loading || !channel) {
    return null;
  }

  return (
    <div className="w-full p-12 space-y-8">
      <h1 className="text-4xl">
        <Link
          href="/"
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          Colloseum
        </Link>{" "}
        <span className="font-extralight">/</span>{" "}
        <Link
          href={`/${handle}`}
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          {handle}
        </Link>{" "}
        <span className="font-extralight">/</span> {channel.title}
      </h1>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Description</h2>
          {channel.description ? <p className="">{channel.description}</p> : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Meta</h2>
          {metaData!.map((meta, index) => (
            // TODO: change the width to be responsive and appropriate for each screen size.
            <div key={index} className="flex w-[350px] justify-between">
              <h3>{meta.title}</h3>
              <p className="font-mono">{meta.data}</p>
            </div>
          ))}
        </div>
      </div>
      <div
        className="grid gap-4 
                grid-cols-5
                3xl:grid-cols-7"
      >
        {isOwner ? (
          <ColumnInput
            user={user}
            columns={columns}
            setColumns={setColumns}
            channel={channel}
            handleMetaData={handleMetaData}
          />
        ) : null}
        {columns.map((column) => (
          <ColumnComponent
            column={column}
            isOwner={isOwner}
            setColumns={setColumns}
            screenshot={column.url ? screenshots.get(column.url) : undefined}
            key={column.id}
          />
        ))}
      </div>
    </div>
  );
}
