import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import NotificationList from "@/components/notification-list";
import { getSessionUser } from "@/lib/auth";
import { listNotifications, NOTIFICATION_PAGE } from "@/lib/colosseum/notification";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }

  // Notifications stay unread until the user marks them (via the button in the
  // list), so the unread highlighting survives a refresh.
  const items = await listNotifications(user.id);

  return (
    // Breadcrumb sits at the page's left edge like every other page; the feed
    // itself stays a centered reading column.
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "notifications" }]} />
      <div className="mx-auto w-full max-w-2xl">
        <NotificationList initial={items} pageSize={NOTIFICATION_PAGE} />
      </div>
    </div>
  );
}
