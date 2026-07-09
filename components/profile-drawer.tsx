"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Code,
  Laptop,
  LogOutIcon,
  MailIcon,
  Moon,
  ScrollText,
  SettingsIcon,
  Sun,
  UserIcon,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

// The mobile avatar opens a bottom drawer of nav links (Profile, Settings,
// Invites, Developers, Changelog), a theme picker, and Logout — the mobile
// counterpart to the desktop avatar dropdown (UserMenu).
export function ProfileDrawer({ handle, avatarUrl }: { handle: string; avatarUrl?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  const logout = async () => {
    await authClient.signOut();
    // Full-document navigation so the server-rendered nav reflects the signed-out
    // session instead of the cached authenticated render.
    window.location.assign("/auth/login");
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        aria-label="Profile menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-9">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{handle.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>@{handle}</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col px-2 pb-6">
          <NavRow icon={<UserIcon size={18} />} label="Profile" onClick={() => go(`/${handle}`)} />
          <NavRow
            icon={<SettingsIcon size={18} />}
            label="Settings"
            onClick={() => go("/settings")}
          />
          <NavRow icon={<MailIcon size={18} />} label="Invites" onClick={() => go("/invites")} />
          <NavRow icon={<Code size={18} />} label="Developers" onClick={() => go("/developers")} />
          <NavRow
            icon={<ScrollText size={18} />}
            label="Changelog"
            onClick={() => go("/changelog")}
          />

          <div className="mt-2 border-t px-2 pt-3">
            <p className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Theme
            </p>
            <div className="flex gap-2">
              <ThemeButton
                active={theme === "light"}
                onClick={() => setTheme("light")}
                icon={<Sun size={16} />}
                label="Light"
              />
              <ThemeButton
                active={theme === "dark"}
                onClick={() => setTheme("dark")}
                icon={<Moon size={16} />}
                label="Dark"
              />
              <ThemeButton
                active={theme === "system"}
                onClick={() => setTheme("system")}
                icon={<Laptop size={16} />}
                label="System"
              />
            </div>
          </div>

          <div className="mt-3 border-t pt-2">
            <NavRow
              icon={<LogOutIcon size={18} />}
              label="Logout"
              onClick={logout}
              className="text-destructive"
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function NavRow({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-md p-3 text-left text-sm hover:bg-accent ${className ?? ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-center gap-1 rounded-md border p-3 text-xs ${
        active ? "border-ring bg-accent" : "hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
