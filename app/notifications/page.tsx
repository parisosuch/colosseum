import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import NotificationList from "@/components/notification-list";
import { getSessionUser } from "@/lib/auth";
import {
  listNotifications,
  NOTIFICATION_PAGE,
  unreadNotificationCount,
} from "@/lib/colosseum/notification";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }

  // The count comes from the database rather than the loaded page: the header
  // has to be able to say "90 unread" over a list holding the first 30.
  const [items, unread] = await Promise.all([
    listNotifications(user.id),
    unreadNotificationCount(user.id),
  ]);

  return (
    // Breadcrumb sits at the page's left edge like every other page; the feed
    // itself stays a centered reading column.
    <div className="w-full p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "notifications" }]} />
      <div className="mx-auto w-full max-w-2xl">
        <NotificationList initial={items} pageSize={NOTIFICATION_PAGE} unreadCount={unread} />
      </div>
    </div>
  );
}
