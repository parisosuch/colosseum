"use client";

import { DownloadIcon } from "lucide-react";

import { Channel } from "@/lib/colosseum/channel";
import { Column } from "@/lib/colosseum/column";
import { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { buildChannelExport, exportFilename, toCSV, toJSON } from "@/lib/colosseum/export";
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
  columns: Column[];
  screenshots: Map<string, ColumnScreenshot>;
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

export default function ExportChannelButton({
  channel,
  columns,
  screenshots,
}: ExportChannelButtonProps) {
  const exportAs = (format: "json" | "csv") => {
    const data = buildChannelExport(channel, columns, screenshots);
    if (format === "json") {
      downloadFile(exportFilename(channel.title, "json"), toJSON(data), "application/json");
    } else {
      downloadFile(exportFilename(channel.title, "csv"), toCSV(data), "text/csv");
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Export">
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
