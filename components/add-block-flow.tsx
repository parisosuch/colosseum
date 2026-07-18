"use client";

import { useState } from "react";
import { ChevronLeftIcon, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import {
  uploadImageColumnAction,
  uploadPdfColumnAction,
  uploadTextColumnAction,
  uploadURLColumnAction,
  uploadVideoColumnAction,
} from "@/lib/colosseum/actions";
import { isURL } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PickableChannel = { id: number; title: string; private: boolean };

// Shared state machine for the quick-add flow: paste/type block content,
// Continue, then pick which channel to drop it in. A URL becomes a link block
// (and kicks off a screenshot), an image/video/PDF becomes a media block, anything
// else a text block. Both the mobile drawer and the desktop modal drive this
// exact hook + body, so the behaviour can never drift — only the shell differs.
export function useAddBlockFlow(channels: PickableChannel[]) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"content" | "channel">("content");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");

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
    setFile(selected);
    setText("");
  };

  const addToChannel = async (channelId: number) => {
    if (submitting) return;
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
        await uploadURLColumnAction({ channelId, text: url });
        // Best-effort: warm the screenshot in the background so the preview is
        // ready by the time the channel is opened.
        void fetch("/api/screenshot", { method: "POST", body: JSON.stringify({ url }) }).catch(
          () => {},
        );
      } else {
        await uploadTextColumnAction({ channelId, text });
      }
      toast.success("Column added.");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add that column. Please try again.");
      setSubmitting(false);
    }
  };

  const title = step === "content" ? "Add a column" : "Add to which channel?";

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
    title,
  };
}

export type AddBlockFlow = ReturnType<typeof useAddBlockFlow>;

// The two-step body (content → channel picker), shell-agnostic. `tall` adds the
// drawer's extra height so there's room to drag-dismiss under the list; the
// modal omits it and sizes to its content. `advanceOnEnter` makes Enter go to
// the channel step (Shift+Enter still inserts a newline) — desktop only; a
// mobile soft-keyboard Enter should stay a newline.
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
  } = flow;

  if (step === "content") {
    return (
      <div className="space-y-3 px-4 pb-6">
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

        <Button className="w-full" disabled={!hasContent} onClick={() => setStep("channel")}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 px-4 pb-6 ${tall ? "min-h-[60dvh]" : ""}`}>
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no channels yet — create one first.
        </p>
      ) : (
        <>
          <input
            type="search"
            value={channelQuery}
            onChange={(e) => setChannelQuery(e.target.value)}
            placeholder="Search channels…"
            // text-base (16px) so iOS doesn't zoom on focus.
            className="w-full shrink-0 rounded-md border bg-transparent p-3 text-base leading-normal focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <ul className="flex max-h-[40dvh] flex-col divide-y overflow-y-auto rounded-md border">
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
            {filteredChannels.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">No channels match.</li>
            ) : null}
          </ul>
        </>
      )}

      <Button variant="ghost" size="sm" disabled={submitting} onClick={() => setStep("content")}>
        <ChevronLeftIcon size={16} /> Back
      </Button>
    </div>
  );
}
