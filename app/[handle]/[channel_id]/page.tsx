"use client";

import { createColumnServerAction } from "@/lib/actions/create-column";
import { Channel, getChannel } from "@/lib/colosseum/channel";
import { Column, getChannelColumns } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function ChannelPage() {
  const params = useParams();
  const handle = params.handle as string;
  const channel_id = params.channel_id as string;

  const [channel, setChannel] = useState<Channel | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [metaData, setMetaData] = useState<{ title: string; data: string }[]>();
  const [loading, setLoading] = useState(true);

  // column form info
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const router = useRouter();
  const supabase = createClient();

  const ColumnComponent = ({ column }: { column: Column }) => {
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) setFile(droppedFile);

    // TODO: handle upload on drop
  };

  const handleTextAreaUpload = async () => {
    if (!user?.id || text === "") return;

    createColumnServerAction({
      created_by: user.id,
      channel_id: channel_id,
      text,
    })
      .then((column) => {
        setColumns([column, ...columns]);
        setText("");
      })
      .catch(console.error);
  };

  const fetchData = async () => {
    setLoading(true);

    try {
      const channelResponse = await getChannel(
        supabase,
        parseInt(channel_id, 10)
      );
      if (!channelResponse) throw new Error("Channel does not exist.");
      setChannel(channelResponse);

      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData.user;

      if (channelResponse.private) {
        if (!currentUser || currentUser.id !== channelResponse.owner_id) {
          router.push("/"); // redirect safely in client component
          return;
        }
      }

      setUser(currentUser);

      const columnsResponse = await getChannelColumns(
        supabase,
        parseInt(channel_id, 10)
      );
      setColumns(columnsResponse);

      const lastModifiedChannel = columnsResponse.at(0);
      let lastModifiedChannelDays: string;
      if (!lastModifiedChannel) {
        lastModifiedChannelDays = "-";
      } else {
        const today = new Date();
        const lastDate = new Date(lastModifiedChannel.created_at);
        const diffInMs = today.getTime() - lastDate.getTime();
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        lastModifiedChannelDays =
          diffInDays === 0 ? "Today" : `${diffInDays} days ago`;
      }

      setMetaData([
        {
          title: "Created On",
          data: new Date(channelResponse.created_at).toLocaleString("default", {
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
          data: columnsResponse.length.toString(),
        },
      ]);
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

  if (loading) {
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
        <span className="font-extralight">/</span> {channel!.title}
      </h1>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Description</h2>
          {channel!.description ? (
            <p className="">{channel!.description}</p>
          ) : null}
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
      <div className="flex gap-4">
        <div
          className={`relative w-[300px] h-[300px] rounded-lg dark:bg-white/10 bg-gray-100 
        ${isDragging ? "border-2 border-dashed dark:border-white/20 border-gray-200" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
        >
          {/* Text input */}
          {!file && (
            <textarea
              ref={textareaRef}
              className="w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder=""
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTextAreaUpload();
                }
              }}
            />
          )}

          {/* Overlay placeholder with clickable Upload */}
          {!text && !file && (
            <div className="absolute inset-0 px-3 pt-3 text-sm leading-normal text-gray-500 flex items-start pointer-events-none">
              <span className="pointer-events-auto">
                Type here... or{" "}
                <label className="underline cursor-pointer">
                  upload file
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>{" "}
                or drop a file
              </span>
            </div>
          )}

          {/* Show file name if file is selected */}
          {file && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-sm break-all px-3">
              <p>{file.name}</p>
            </div>
          )}
        </div>
        {columns.map((column) => (
          <Dialog key={column.id}>
            <DialogTrigger>
              <div className="group relative w-[300px]">
                <div className="w-[300px] h-[300px] border rounded-lg text-left p-2">
                  {column.type === "text" ? (
                    <p>{column.text}</p>
                  ) : (
                    <p>this is a url here</p>
                  )}
                </div>
                <p className="opacity-0 group-hover:opacity-100 transition-opacity pt-1 text-xs font-light">
                  {timeAgo(new Date(column.created_at))}
                </p>
              </div>
            </DialogTrigger>
            <DialogContent className="w-[97vw] !h-[97vh] !max-w-none p-4">
              <DialogTitle>Title goes here</DialogTitle>
            </DialogContent>
          </Dialog>
        ))}
      </div>
    </div>
  );
}
