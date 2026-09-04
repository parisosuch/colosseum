"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  HomeIcon,
  Laptop,
  LayersIcon,
  LogOutIcon,
  MailIcon,
  Moon,
  SettingsIcon,
  Sun,
  UserIcon,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import type { Column } from "@/lib/colosseum/column";
import { useSearch } from "@/components/use-search";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

function blockLabel(column: Column): string {
  return column.title || column.url || column.text || "Untitled";
}

// Each of the three search queries returns up to ten rows, so an unfiltered
// palette could open with thirty results stacked above the commands. Show the
// best few per group and say how many were held back; a searcher who wants the
// rest is better served by typing another word than by scrolling.
const RESULT_LIMIT = 5;

function groupHeading(label: string, shown: number, total: number): string {
  return shown < total ? `${label} (${shown} of ${total})` : label;
}

// Cmd/Ctrl+K palette for common navigation and flows: jump to a page, search
// across everyone's public profiles/channels/blocks (plus your own), switch
// theme, or log out. Mounted in the nav for onboarded users (needs `handle` for
// the page-jump links). Filtering is driven manually (shouldFilter={false}) so
// server search results are never hidden by cmdk's client-side text match.
export default function CommandPalette({ handle }: { handle: string }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const {
    results: { profiles, channels, columns },
    searching,
  } = useSearch(query);

  // Global Cmd+K / Ctrl+K to toggle the palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset the query whenever the palette closes so it reopens clean.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const runCommand = (action: () => void) => {
    setOpen(false);
    action();
  };

  const navItems = useMemo(
    () => [
      // Home is where the nav logo and the bottom bar's home tab land — the
      // user's own profile is reachable as Profile, the name the user menu uses.
      { label: "Home", icon: HomeIcon, run: () => router.push("/explore") },
      { label: "Profile", icon: UserIcon, run: () => router.push(`/${handle}`) },
      { label: "Settings", icon: SettingsIcon, run: () => router.push("/settings") },
      { label: "Invites", icon: MailIcon, run: () => router.push("/invites") },
    ],
    [router, handle],
  );

  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const visibleNav = navItems.filter((i) => matches(i.label));
  const themeItems = [
    { label: "Light", icon: Sun, value: "light" },
    { label: "Dark", icon: Moon, value: "dark" },
    { label: "System", icon: Laptop, value: "system" },
  ].filter((i) => matches(i.label));
  const showLogout = matches("Log out");

  const shownProfiles = profiles.slice(0, RESULT_LIMIT);
  const shownChannels = channels.slice(0, RESULT_LIMIT);
  const shownColumns = columns.slice(0, RESULT_LIMIT);

  // Whether the query names a command rather than merely occurring somewhere in
  // one. Commands are visible on a substring match ("set" keeps Settings, and so
  // does "ting"), but only a prefix is evidence the user was typing that word:
  // "settings" means the settings page, not the channel whose description
  // mentions settings. When there is such a match the commands take the top of
  // the list — and with it the highlight, so Enter runs the command that was
  // named. Everything else leaves search results first, where they belong.
  const commandLabels = [
    ...visibleNav.map((i) => i.label),
    ...themeItems.map((i) => i.label),
    ...(showLogout ? ["Log out"] : []),
  ];
  const commandFirst = q.length > 0 && commandLabels.some((l) => l.toLowerCase().startsWith(q));

  // Values of every rendered item, in the same order they appear in the list.
  // With shouldFilter={false} cmdk stops auto-highlighting the first item, so
  // we drive the selection ourselves (below) using this order. The two halves
  // are swapped in the JSX by the same flag, so the order here always matches
  // what is on screen.
  const resultValues = [
    ...shownProfiles.map((profile) => `profile-${profile.handle}`),
    ...shownChannels.map((channel) => `channel-${channel.id}`),
    ...shownColumns.map((column) => `block-${column.id}`),
  ];
  const commandValues = [
    ...visibleNav.map((i) => i.label),
    ...themeItems.map((i) => `theme-${i.value}`),
    ...(showLogout ? ["logout"] : []),
  ];
  const itemValues = commandFirst
    ? [...commandValues, ...resultValues]
    : [...resultValues, ...commandValues];

  // Keep the highlight on a live item, snapping to the first whenever the
  // current selection is gone (e.g. results just changed). This ensures Enter
  // fires the top result without arrowing down first.
  const [selected, setSelected] = useState("");
  const activeValue = itemValues.includes(selected) ? selected : (itemValues[0] ?? "");

  const resultGroups = (
    <>
      {shownProfiles.length > 0 ? (
        <CommandGroup heading={groupHeading("People", shownProfiles.length, profiles.length)}>
          {shownProfiles.map((profile) => (
            <CommandItem
              key={`profile-${profile.handle}`}
              value={`profile-${profile.handle}`}
              onSelect={() => runCommand(() => router.push(`/${profile.handle}`))}
            >
              <UserIcon />@{profile.handle}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {shownChannels.length > 0 ? (
        <CommandGroup heading={groupHeading("Channels", shownChannels.length, channels.length)}>
          {shownChannels.map((channel) => (
            <CommandItem
              key={`channel-${channel.id}`}
              value={`channel-${channel.id}`}
              onSelect={() => runCommand(() => router.push(`/${channel.handle}/${channel.id}`))}
            >
              <LayersIcon />
              {channel.title}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {shownColumns.length > 0 ? (
        <CommandGroup heading={groupHeading("Columns", shownColumns.length, columns.length)}>
          {shownColumns.map((column) => (
            <CommandItem
              key={`block-${column.id}`}
              value={`block-${column.id}`}
              onSelect={() =>
                runCommand(() => router.push(`/${column.handle}/${column.channel_id}/${column.id}`))
              }
            >
              {blockLabel(column)}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );

  const commandGroups = (
    <>
      {visibleNav.length > 0 ? (
        <CommandGroup heading="Navigation">
          {visibleNav.map(({ label, icon: Icon, run }) => (
            <CommandItem key={label} value={label} onSelect={() => runCommand(run)}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {themeItems.length > 0 ? (
        <CommandGroup heading="Theme">
          {themeItems.map(({ label, icon: Icon, value }) => (
            <CommandItem
              key={value}
              value={`theme-${value}`}
              onSelect={() => runCommand(() => setTheme(value))}
            >
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {showLogout ? (
        <>
          <CommandSeparator />
          <CommandGroup heading="Account">
            <CommandItem
              value="logout"
              onSelect={() =>
                runCommand(async () => {
                  await authClient.signOut();
                  // Full-document nav so the server nav reflects the signed-out session.
                  window.location.assign("/auth/login");
                })
              }
            >
              <LogOutIcon />
              Log out
            </CommandItem>
          </CommandGroup>
        </>
      ) : null}
    </>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      commandProps={{ shouldFilter: false, value: activeValue, onValueChange: setSelected }}
      title="Command palette"
      description="Search your channels and columns, or jump to a page."
    >
      <CommandInput
        placeholder="Type a command or search…"
        value={query}
        onValueChange={setQuery}
      />
      {/* A fixed height rather than a max. The commands the palette opens with
          already overflow 300px, so every narrower state — a one-character
          query that filters them away, a search in flight with nothing yet to
          show, results that fill half the box — shrank the modal around its
          center point and slid the input up under the cursor mid-word. The
          frame stays put now and only the contents move. */}
      <CommandList className="h-[300px]">
        {/* cmdk mounts this only when nothing else is rendered, which is also
            the moment a search is most likely still out. Saying so beats
            "No results." — that's a verdict this hasn't reached yet. */}
        <CommandEmpty>{searching ? "Searching…" : "No results."}</CommandEmpty>

        {commandFirst ? (
          <>
            {commandGroups}
            {resultGroups}
          </>
        ) : (
          <>
            {resultGroups}
            {commandGroups}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
