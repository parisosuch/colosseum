"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ImageIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import {
  getColumnQuotaAction,
  getMyProfileAction,
  uploadImageColumnAction,
  uploadPdfColumnAction,
  uploadTextColumnAction,
  uploadURLColumnAction,
  uploadVideoColumnAction,
} from "@/lib/colosseum/actions";
import { columnLimitMessage } from "@/lib/quota";
import { isURL } from "@/lib/utils";
import type { Channel } from "@/lib/colosseum/channel";
import CreateChannelForm from "@/components/create-channel-form";
import { Button } from "@/components/ui/button";

export type PickableChannel = { id: number; title: string; private: boolean };

// Per-type upload caps, kept in sync with the server limits in
// lib/colosseum/blob.ts (and the next.config server-action body limit, which
// must sit above the largest of these). Validated client-side so an oversized
// file gets a clear toast instead of an opaque server-action body error.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function fileTooLargeMessage(file: File): string | null {
  const isVideo = file.type.startsWith("video/");
  const isPdf = file.type === "application/pdf";
  const cap = isVideo ? MAX_VIDEO_BYTES : isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size <= cap) return null;
  return `That file is too large (max ${isVideo ? "100MB" : isPdf ? "25MB" : "10MB"}).`;
}

// Shared state machine for the quick-add flow: paste/type block content,
// Continue, then pick which channel to drop it in. A URL becomes a link block
// (and kicks off a screenshot), an image/video/PDF becomes a media block, anything
// else a text block. Both the mobile drawer and the desktop modal drive this
// exact hook + body, so the behaviour can never drift — only the shell differs.
export function useAddBlockFlow(channels: PickableChannel[]) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"content" | "channel" | "new-channel">("content");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const router = useRouter();

  const hasContent = file != null || text.trim() !== "";
  const q = channelQuery.trim().toLowerCase();
  const filteredChannels = q ? channels.filter((c) => c.title.toLowerCase().includes(q)) : channels;

  const reset = () => {
    setStep("content");
    setText("");
    setFile(null);
    setSubmitting(false);
    setChannelQuery("");
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const pickFile = (selected: File | undefined) => {
    if (!selected) return;
    if (
      !selected.type.startsWith("image/") &&
      !selected.type.startsWith("video/") &&
      selected.type !== "application/pdf"
    ) {
      toast.error("That's not an image, video, or PDF.");
      return;
    }
    const tooLarge = fileTooLargeMessage(selected);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }
    setFile(selected);
    setText("");
  };

  const addToChannel = async (channelId: number): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    try {
      if (file) {
        const formData = new FormData();
        formData.set("channelId", String(channelId));
        formData.set("file", file);
        if (file.type === "application/pdf") {
          await uploadPdfColumnAction(formData);
        } else if (file.type.startsWith("video/")) {
          await uploadVideoColumnAction(formData);
        } else {
          await uploadImageColumnAction(formData);
        }
      } else if (isURL(text)) {
        const url = text.startsWith("http") ? text : `https://${text}`;
        const column = await uploadURLColumnAction({ channelId, text: url });
        // Best-effort: warm the screenshot in the background so the preview is
        // ready by the time the channel is opened. An image URL comes back as an
        // image block, which carries its own bytes and has nothing to capture.
        if (column.type === "url") {
          void fetch("/api/screenshot", { method: "POST", body: JSON.stringify({ url }) }).catch(
            () => {},
          );
        }
      } else {
        await uploadTextColumnAction({ channelId, text });
      }
      toast.success("Column added.");
      onOpenChange(false);
      return true;
    } catch (e) {
      console.error(e);
      const quota = await getColumnQuotaAction().catch(() => null);
      toast.error(
        (quota && columnLimitMessage(quota, quota.admins)) ||
          "Couldn't add that column. Please try again.",
      );
      setSubmitting(false);
      return false;
    }
  };

  // Create-then-add is two writes. If the add fails the channel still exists,
  // so open it rather than leaving behind an empty one nobody saw.
  const addToNewChannel = async (channel: Channel) => {
    if (await addToChannel(channel.id)) {
      // The channel lists are server-rendered, so pull the new one in.
      router.refresh();
      return;
    }
    const profile = await getMyProfileAction();
    if (profile) router.push(`/${profile.handle}/${channel.id}`);
    onOpenChange(false);
  };

  const title =
    step === "content"
      ? "Add a column"
      : step === "new-channel"
        ? "New channel"
        : "Add to which channel?";

  return {
    open,
    onOpenChange,
    step,
    setStep,
    text,
    setText,
    file,
    setFile,
    pickFile,
    submitting,
    channelQuery,
    setChannelQuery,
    hasContent,
    filteredChannels,
    channels,
    addToChannel,
    addToNewChannel,
    title,
  };
}

export type AddBlockFlow = ReturnType<typeof useAddBlockFlow>;

// The body (content → channel picker → inline channel form), shell-agnostic.
// `tall` fills a shell of a fixed height (the drawer, which must not resize
// between steps — see add-block-drawer.tsx); the modal omits it and sizes to
// its content.
// `advanceOnEnter` makes Enter go to the channel step (Shift+Enter still
// inserts a newline) — desktop only; a mobile soft-keyboard Enter should stay a
// newline.
export function AddBlockBody({
  flow,
  tall = false,
  advanceOnEnter = false,
}: {
  flow: AddBlockFlow;
  tall?: boolean;
  advanceOnEnter?: boolean;
}) {
  const {
    step,
    setStep,
    text,
    setText,
    file,
    setFile,
    pickFile,
    submitting,
    channelQuery,
    setChannelQuery,
    hasContent,
    filteredChannels,
    channels,
    addToChannel,
    addToNewChannel,
  } = flow;

  if (step === "content") {
    return (
      <div className={`flex flex-col gap-3 px-4 pb-6 ${tall ? "min-h-0 flex-1" : ""}`}>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) setFile(null);
          }}
          onPaste={(e) => {
            const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (img) {
              e.preventDefault();
              pickFile(img);
            }
          }}
          onKeyDown={(e) => {
            // Enter advances to the channel step; Shift+Enter inserts a newline.
            if (advanceOnEnter && e.key === "Enter" && !e.shiftKey && hasContent) {
              e.preventDefault();
              setStep("channel");
            }
          }}
          placeholder="Paste a link or an image, or type text…"
          // text-base (16px) so iOS doesn't zoom on focus.
          className="min-h-28 w-full resize-none rounded-md border bg-transparent p-3 text-base leading-normal focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {file ? (
          <p className="truncate text-sm text-muted-foreground">File: {file.name}</p>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground underline">
            <ImageIcon size={16} />
            Upload an image, video, or PDF
            <input
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime,video/ogg,application/pdf"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {/* Pinned to the bottom of the sheet, where the thumb is. */}
        <Button
          className={`w-full ${tall ? "mt-auto" : ""}`}
          disabled={!hasContent}
          onClick={() => setStep("channel")}
        >
          Continue
        </Button>
      </div>
    );
  }

  if (step === "new-channel") {
    return (
      <div
        className={`flex flex-col gap-3 px-4 pb-6 ${tall ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        <CreateChannelForm submitLabel="Create and add" onCreated={addToNewChannel} />
        <Button
          variant="ghost"
          size="sm"
          className={tall ? "mt-auto" : ""}
          onClick={() => setStep("channel")}
        >
          <ChevronLeftIcon size={16} /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 px-4 pb-6 ${tall ? "min-h-0 flex-1" : ""}`}>
      {channels.length > 0 ? (
        <input
          type="search"
          value={channelQuery}
          onChange={(e) => setChannelQuery(e.target.value)}
          placeholder="Search channels…"
          // text-base (16px) so iOS doesn't zoom on focus.
          className="w-full shrink-0 rounded-md border bg-transparent p-3 text-base leading-normal focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : null}
      {/* In the sheet the list shrink-wraps a short channel list and
          shrinks to fit a long one — min-h-0 is what lets a flex child
          shrink past its content. The modal's shell has no height to
          shrink against, so there it stays capped. */}
      <ul
        className={`flex flex-col divide-y overflow-y-auto rounded-md border ${tall ? "min-h-0" : "max-h-[40dvh]"}`}
      >
        {filteredChannels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => addToChannel(channel.id)}
              className={`flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-accent disabled:opacity-50 ${channel.private ? "bg-red-500/5 border-red-500/50 hover:border-red-500" : ""}`}
            >
              <span className="truncate">{channel.title}</span>
              {channel.private ? (
                <span className="shrink-0 text-xs text-muted-foreground">private</span>
              ) : null}
            </button>
          </li>
        ))}
        {filteredChannels.length === 0 && channels.length > 0 ? (
          <li className="p-3 text-sm text-muted-foreground">No channels match.</li>
        ) : null}
        {/* Always last, so somebody with no channels — or a search that
            matches none — has somewhere to go other than back. */}
        <li>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setStep("new-channel")}
            className="flex w-full items-center gap-2 p-3 text-left text-sm hover:bg-accent disabled:opacity-50"
          >
            <PlusIcon size={16} className="shrink-0" />
            <span>New channel…</span>
          </button>
        </li>
      </ul>

      {/* Pinned to the bottom of the sheet, so it doesn't move as the list
          length changes and the slack above it stays draggable. */}
      <Button
        variant="ghost"
        size="sm"
        className={tall ? "mt-auto" : ""}
        disabled={submitting}
        onClick={() => setStep("content")}
      >
        <ChevronLeftIcon size={16} /> Back
      </Button>
    </div>
  );
}
