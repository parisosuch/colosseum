"use client";

import { useState } from "react";
import { ChevronLeftIcon, ImageIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import {
  uploadImageColumnAction,
  uploadPdfColumnAction,
  uploadTextColumnAction,
  uploadURLColumnAction,
} from "@/lib/colosseum/actions";
import { isURL } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

export type PickableChannel = { id: number; title: string; private: boolean };

// The bottom-nav "+": a drawer to paste/type block content, Continue, then pick
// which channel to drop it in. A URL becomes a link block (and kicks off a
// screenshot), an image becomes an image block, anything else a text block.
export function AddBlockDrawer({ channels }: { channels: PickableChannel[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"content" | "channel">("content");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasContent = file != null || text.trim() !== "";

  const reset = () => {
    setStep("content");
    setText("");
    setFile(null);
    setSubmitting(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const pickFile = (selected: File | undefined) => {
    if (!selected) return;
    if (!selected.type.startsWith("image/") && selected.type !== "application/pdf") {
      toast.error("That's not an image or PDF.");
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger
        aria-label="Add column"
        className="flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlusIcon />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{step === "content" ? "Add a column" : "Add to which channel?"}</DrawerTitle>
        </DrawerHeader>

        {step === "content" ? (
          <div className="space-y-3 px-4 pb-6">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value) setFile(null);
              }}
              onPaste={(e) => {
                const img = Array.from(e.clipboardData.files).find((f) =>
                  f.type.startsWith("image/"),
                );
                if (img) {
                  e.preventDefault();
                  pickFile(img);
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
                Upload an image or PDF
                <input
                  type="file"
                  accept="image/*,application/pdf"
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
        ) : (
          <div className="space-y-3 px-4 pb-6">
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have no channels yet — create one first.
              </p>
            ) : (
              <ul className="flex max-h-[50dvh] flex-col divide-y overflow-y-auto rounded-md border">
                {channels.map((channel) => (
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
              </ul>
            )}

            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => setStep("content")}
            >
              <ChevronLeftIcon size={16} /> Back
            </Button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
