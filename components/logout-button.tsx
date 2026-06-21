"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full-document navigation so the server-rendered nav (root layout) reflects
    // the signed-out session instead of the cached authenticated render.
    window.location.assign("/auth/login");
  };

  return <Button onClick={logout}>Logout</Button>;
}
