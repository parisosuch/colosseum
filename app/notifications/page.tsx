import { redirect } from "next/navigation";

import PageHeader from "@/components/page-header";
import NotificationList from "@/components/notification-list";
import { getSessionUser } from "@/lib/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  NOTIFICATION_PAGE,
} from "@/lib/colosseum/notification";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/login");
  }

  // Read the current page first (so unread rows still render highlighted), then
  // clear the unread badge.
  const items = await listNotifications(user.id);
  await markAllNotificationsRead(user.id);

  return (
    <div className="w-full max-w-xl p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "notifications" }]} />
      <NotificationList initial={items} pageSize={NOTIFICATION_PAGE} />
    </div>
  );
}
