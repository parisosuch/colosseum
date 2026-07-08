"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Laptop, LogOutIcon, MailIcon, Moon, SettingsIcon, Sun, UserIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICON_SIZE = 16;

function ThemeIcon({ theme }: { theme?: string }) {
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return <Icon size={ICON_SIZE} className="text-muted-foreground" />;
}

// The desktop avatar menu body: Profile, Settings, Invites, a Theme submenu,
// and Logout. (The mobile bottom nav mirrors these in ProfileDrawer.)
export function UserMenuItems({ handle }: { handle: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const logout = async () => {
    await authClient.signOut();
    // Full-document navigation so the server-rendered nav reflects the signed-out
    // session instead of the cached authenticated render.
    window.location.assign("/auth/login");
  };

  return (
    <>
      <DropdownMenuItem onSelect={() => router.push(`/${handle}`)}>
        <UserIcon />
        Profile
      </DropdownMenuItem>

      <DropdownMenuItem onSelect={() => router.push("/settings")}>
        <SettingsIcon />
        Settings
      </DropdownMenuItem>

      <DropdownMenuItem onSelect={() => router.push("/invites")}>
        <MailIcon />
        Invites
      </DropdownMenuItem>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <ThemeIcon theme={theme} />
          Theme
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem className="gap-2" value="light">
              <Sun size={ICON_SIZE} className="text-muted-foreground" /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="gap-2" value="dark">
              <Moon size={ICON_SIZE} className="text-muted-foreground" /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="gap-2" value="system">
              <Laptop size={ICON_SIZE} className="text-muted-foreground" /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />

      <DropdownMenuItem onSelect={logout}>
        <LogOutIcon />
        Logout
      </DropdownMenuItem>
    </>
  );
}

// Avatar in the nav opens the shared menu. (Logged-out users get the standalone
// ThemeSwitcher instead.)
export function UserMenu({ avatarUrl, handle }: { avatarUrl?: string; handle: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-10">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{handle.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <UserMenuItems handle={handle} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
