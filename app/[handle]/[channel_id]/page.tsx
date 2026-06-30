"use client";

import BrandLink from "@/components/brand-link";
import ColumnComponent from "@/components/column";
import ManageChannelButton from "@/components/manage-channel-button";
import ExportChannelButton from "@/components/export-channel-button";
import ColumnInput from "@/components/column-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Channel, getChannel } from "@/lib/colosseum/channel";
import { Column, getChannelColumns } from "@/lib/colosseum/column";
import { ColumnScreenshot, getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const [fetchError, setFetchError] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");

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
      setFetchError(true);
      toast.error("Failed to load channel.");
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
            next.set(
              url,
              fetched.get(url) ?? { url, image_url: null, title: null, captured_at: null },
            );
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

  if (loading) {
    return (
      <div className="w-full h-[60vh] flex items-center justify-center">
        <Spinner variant="circle" className="size-8 text-black/30 dark:text-white/30" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="w-full p-12 space-y-2">
        <h1 className="text-4xl">
          <BrandLink /> <span className="font-extralight">/ {handle}</span>
        </h1>
        <p className="text-black/50 dark:text-white/50">
          Something went wrong loading this channel.
        </p>
      </div>
    );
  }

  // `channel` stays null while a redirect (not-found / RLS-hidden) is in
  // flight, so guard on it too — `loading` is already false by then.
  if (!channel) {
    return null;
  }

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <h1 className="text-2xl sm:text-4xl">
        <BrandLink /> <span className="font-extralight">/</span>{" "}
        <Link
          href={`/${handle}`}
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          {handle}
        </Link>{" "}
        <span className="font-extralight">/</span> {channel.title}
      </h1>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <ManageChannelButton channel={channel} handle={handle} onUpdated={setChannel} />
        ) : null}
        <ExportChannelButton channel={channel} columns={columns} screenshots={screenshots} />
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Grid view"
          onClick={() => setView("grid")}
        >
          <LayoutGrid />
        </Button>
        <Button
          variant={view === "list" ? "secondary" : "ghost"}
          size="icon"
          aria-label="List view"
          onClick={() => setView("list")}
        >
          <List />
        </Button>
      </div>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Description</h2>
          {channel.description ? <p className="">{channel.description}</p> : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Meta</h2>
          {metaData!.map((meta, index) => (
            <div key={index} className="flex w-full max-w-[350px] justify-between">
              <h3>{meta.title}</h3>
              <p className="font-mono">{meta.data}</p>
            </div>
          ))}
        </div>
      </div>
      {!isOwner && columns.length === 0 ? (
        <p className="text-black/50 dark:text-white/50">No blocks yet.</p>
      ) : (
        <div
          className={
            view === "grid"
              ? "grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-7"
              : "flex flex-col gap-2"
          }
        >
          {isOwner ? (
            <div className={view === "list" ? "max-w-xs" : undefined}>
              <ColumnInput
                user={user}
                columns={columns}
                setColumns={setColumns}
                channel={channel}
                handleMetaData={handleMetaData}
              />
            </div>
          ) : null}
          {columns.map((column) => (
            <ColumnComponent
              column={column}
              isOwner={isOwner}
              handle={handle}
              setColumns={setColumns}
              screenshot={column.url ? screenshots.get(column.url) : undefined}
              view={view}
              key={column.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
