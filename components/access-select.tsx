"use client";

import type { ChannelAccess } from "@/lib/colosseum/channel";
import { Label } from "./ui/label";

// The three channel access modes, with the copy shown in the create/manage
// forms. Kept here so both forms describe them identically.
const OPTIONS: { value: ChannelAccess; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Anyone can view; you and invited members can add." },
  { value: "open", label: "Open", hint: "Anyone can view and add blocks." },
  { value: "private", label: "Private", hint: "Only you and invited members can view or add." },
];

// A radio group for a channel's access mode. `idPrefix` keeps input ids unique
// when more than one selector renders on a page.
export default function AccessSelect({
  value,
  onChange,
  idPrefix = "access",
}: {
  value: ChannelAccess;
  onChange: (value: ChannelAccess) => void;
  idPrefix?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Access</legend>
      {OPTIONS.map((opt) => {
        const id = `${idPrefix}-${opt.value}`;
        return (
          <div key={opt.value} className="flex items-start gap-2">
            <input
              id={id}
              type="radio"
              name={idPrefix}
              className="mt-1"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <div className="flex flex-col">
              <Label htmlFor={id} className="cursor-pointer">
                {opt.label}
              </Label>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
