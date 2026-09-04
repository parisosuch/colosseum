"use client";

import { ListFilterIcon, ArrowDownUpIcon, SearchIcon } from "lucide-react";

import type { ColumnFilter, ColumnSort } from "@/lib/colosseum/column";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type ChannelControlsProps = {
  search: string;
  onSearchChange: (value: string) => void;
  type: ColumnFilter;
  onTypeChange: (value: ColumnFilter) => void;
  sort: ColumnSort;
  onSortChange: (value: ColumnSort) => void;
};

// Every option maps onto a set of stored block types (COLUMN_FILTER_TYPES), not
// onto one: "Links" covers the eight kinds a pasted URL is classified into, so
// a channel of YouTube links is no longer invisible to its own filter. The
// options between them reach all twelve types.
const TYPE_LABELS: Record<ColumnFilter, string> = {
  all: "All types",
  url: "Links",
  text: "Text",
  image: "Images",
  video: "Video",
  pdf: "PDFs",
  channel: "Channels",
};

// "Manual" is the channel's own arrangement, and the only mode blocks can be
// dragged in — a drag under any of the other four would be undone by the next
// read, since those orders are computed from the block rather than stored.
// Key order is the order of the menu, and manual leads it because it is the
// board's default: a channel nobody has rearranged reads exactly as "Newest"
// did, and one that has been arranged shows that arrangement to every visitor
// rather than only to the person who made it.
const SORT_LABELS: Record<ColumnSort, string> = {
  manual: "Manual",
  newest: "Newest",
  oldest: "Oldest",
  title_az: "Title A–Z",
  title_za: "Title Z–A",
};

// Search / filter / sort controls for a channel's blocks. Available to every
// viewer (not just the owner); the parent runs each value through the column
// query so filtering happens server-side.
export default function ChannelControls({
  search,
  onSearchChange,
  type,
  onTypeChange,
  sort,
  onSortChange,
}: ChannelControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search columns"
          aria-label="Search columns"
          className="pl-8"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <ListFilterIcon />
            {TYPE_LABELS[type]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={type}
            onValueChange={(value) => onTypeChange(value as ColumnFilter)}
          >
            {(Object.keys(TYPE_LABELS) as ColumnFilter[]).map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {TYPE_LABELS[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <ArrowDownUpIcon />
            {SORT_LABELS[sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => onSortChange(value as ColumnSort)}
          >
            {(Object.keys(SORT_LABELS) as ColumnSort[]).map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {SORT_LABELS[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
