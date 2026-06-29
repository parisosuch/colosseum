"use client";

import { useEffect, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  BlockChannel,
  connectBlockToChannel,
  disconnectBlockFromChannel,
  getBlockChannels,
} from "@/lib/colosseum/column";
import { Channel, getUserChannels } from "@/lib/colosseum/channel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// Shows which channels a block is connected to, and (for the owner) lets it be
// connected to / disconnected from their channels. Connecting a block to several
// channels is the core are.na-style "connections" capability.
export default function BlockConnections({
  blockId,
  isOwner,
}: {
  blockId: number;
  isOwner: boolean;
}) {
  const [channels, setChannels] = useState<BlockChannel[]>([]);
  const [myChannels, setMyChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const connected = await getBlockChannels(supabase, blockId);
        if (cancelled) return;
        setChannels(connected);

        if (isOwner) {
          const { data } = await supabase.auth.getUser();
          if (data.user) {
            const all = await getUserChannels(supabase, data.user.id);
            if (!cancelled) setMyChannels(all);
          }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Couldn't load connections.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blockId, isOwner, supabase]);

  const connectedIds = new Set(channels.map((c) => c.id));
  const connectable = myChannels.filter((c) => !connectedIds.has(c.id));

  const handleConnect = async (channel: Channel) => {
    setError(null);
    try {
      await connectBlockToChannel(supabase, blockId, channel.id);
      setChannels((prev) => [
        ...prev,
        { id: channel.id, title: channel.title, private: channel.private },
      ]);
    } catch (e) {
      console.error(e);
      setError("Couldn't connect to that channel.");
    }
  };

  const handleDisconnect = async (channelId: number) => {
    setError(null);
    try {
      await disconnectBlockFromChannel(supabase, blockId, channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
    } catch (e) {
      console.error(e);
      setError("Couldn't disconnect from that channel.");
    }
  };

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-light">Channels</h3>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <ul className="space-y-1">
            {channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {c.title}
                  {c.private ? <span className="text-muted-foreground"> · private</span> : null}
                </span>
                {/* Keep at least one connection — disconnecting the last would
                    drop the block from every board. Delete the block instead. */}
                {isOwner && channels.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(c.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Disconnect from ${c.title}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {isOwner && connectable.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-xs underline font-light">
                <PlusIcon className="size-3" /> Connect to channel
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {connectable.map((c) => (
                  <DropdownMenuItem key={c.id} onSelect={() => handleConnect(c)}>
                    {c.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </>
      )}
    </div>
  );
}
