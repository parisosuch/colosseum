"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Laptop, LogOutIcon, MailIcon, Moon, SettingsIcon, Sun } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
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

// Avatar in the nav opens an anchored menu: Settings, a Theme submenu, and
// Logout. (Logged-out users get the standalone ThemeSwitcher instead.)
export function UserMenu({ avatarUrl, handle }: { avatarUrl?: string; handle: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full-document navigation so the server-rendered nav reflects the signed-out
    // session instead of the cached authenticated render.
    window.location.assign("/auth/login");
  };

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarImage src={avatarUrl} />
          <AvatarFallback>{handle.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
            <ThemeIcon size={ICON_SIZE} className="text-muted-foreground" />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
