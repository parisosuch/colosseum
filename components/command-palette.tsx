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
import { searchAction } from "@/lib/colosseum/actions";
import type { ChannelSearchResult } from "@/lib/colosseum/channel";
import type { Column, ColumnSearchResult } from "@/lib/colosseum/column";
import type { ProfileSearchResult } from "@/lib/colosseum/user";
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
  const [profiles, setProfiles] = useState<ProfileSearchResult[]>([]);
  const [channels, setChannels] = useState<ChannelSearchResult[]>([]);
  const [columns, setColumns] = useState<ColumnSearchResult[]>([]);

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

  // Search on every keystroke (no debounce) so results feel instant. The
  // cancelled flag drops stale responses if they land out of order.
  useEffect(() => {
    if (!query.trim()) {
      setProfiles([]);
      setChannels([]);
      setColumns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await searchAction(query);
      if (cancelled) return;
      setProfiles(results.profiles);
      setChannels(results.channels);
      setColumns(results.columns);
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

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
      { label: "Home", icon: HomeIcon, run: () => router.push(`/${handle}`) },
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

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      commandProps={{ shouldFilter: false }}
      title="Command palette"
      description="Search your channels and columns, or jump to a page."
    >
      <CommandInput
        placeholder="Type a command or search…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {profiles.length > 0 ? (
          <CommandGroup heading="People">
            {profiles.map((profile) => (
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

        {channels.length > 0 ? (
          <CommandGroup heading="Channels">
            {channels.map((channel) => (
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

        {columns.length > 0 ? (
          <CommandGroup heading="Columns">
            {columns.map((column) => (
              <CommandItem
                key={`block-${column.id}`}
                value={`block-${column.id}`}
                onSelect={() =>
                  runCommand(() =>
                    router.push(`/${column.handle}/${column.channel_id}/${column.id}`),
                  )
                }
              >
                {blockLabel(column)}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

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
      </CommandList>
    </CommandDialog>
  );
}
