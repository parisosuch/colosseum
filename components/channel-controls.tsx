"use client";

import { ListFilterIcon, ArrowDownUpIcon, SearchIcon } from "lucide-react";

import { ColumnFilter, ColumnSort } from "@/lib/colosseum/column";
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

const TYPE_LABELS: Record<ColumnFilter, string> = {
  all: "All types",
  url: "Links",
  text: "Text",
  image: "Images",
};

const SORT_LABELS: Record<ColumnSort, string> = {
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
          placeholder="Search blocks"
          aria-label="Search blocks"
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
