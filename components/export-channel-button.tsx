"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { Channel } from "@/lib/colosseum/channel";
import { getChannelColumns } from "@/lib/colosseum/column";
import { getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
import { buildChannelExport, exportFilename, toCSV, toJSON } from "@/lib/colosseum/export";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type ExportChannelButtonProps = {
  channel: Channel;
};

function downloadFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click-initiated download isn't cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ExportChannelButton({ channel }: ExportChannelButtonProps) {
  const supabase = createClient();
  const [exporting, setExporting] = useState(false);

  // Pull the whole channel at export time rather than relying on whatever the
  // page currently has loaded — the channel page paginates, so its in-memory
  // columns are only the visible slice. An export must always be complete.
  const exportAs = async (format: "json" | "csv") => {
    if (exporting) return;
    setExporting(true);
    try {
      const columns = await getChannelColumns(supabase, channel.id);
      const urls = columns.filter((c) => c.type === "url" && c.url).map((c) => c.url!);
      const screenshots = await getScreenshotsForUrls(supabase, urls);
      const data = buildChannelExport(channel, columns, screenshots);
      if (format === "json") {
        downloadFile(exportFilename(channel.title, "json"), toJSON(data), "application/json");
      } else {
        downloadFile(exportFilename(channel.title, "csv"), toCSV(data), "text/csv");
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't export this channel. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Export" disabled={exporting}>
                <DownloadIcon />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => exportAs("json")}>JSON</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportAs("csv")}>CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent>Export</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
