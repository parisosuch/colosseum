import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import AdminManager from "@/components/admin-manager";
import { getSessionUser } from "@/lib/auth";
import { getAppSettings, listUsers } from "@/lib/colosseum/admin";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }
  // Non-admins have no business here; don't reveal the page exists.
  if (!user.is_admin) {
    redirect("/");
  }

  const [settings, users] = await Promise.all([getAppSettings(), listUsers()]);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "admin" }]} />
      <p className="text-sm text-muted-foreground max-w-prose">
        Instance controls. Limits use the convention: blank = unlimited, 0 = none. A per-user
        override wins over the global default.
      </p>
      <AdminManager currentUserId={user.id} initialSettings={settings} initialUsers={users} />
    </div>
  );
}
