import Link from "next/link";
import { redirect } from "next/navigation";
import { UsersIcon } from "lucide-react";

import CreateGroupButton from "@/components/create-group-button";
import PageHeader from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { UserProfilePicture } from "@/components/user-profile-picture";
import { getSessionUser } from "@/lib/auth";
import { listUserGroups } from "@/lib/colosseum/group";
import { getUserProfile } from "@/lib/colosseum/user";

// The groups you're in, and the way to start one. A group's own page is
// /{handle} like anyone else's — this is just the index, since a group you
// belong to is otherwise only reachable by remembering its handle.
export default async function GroupsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  const profile = await getUserProfile(user.id);
  if (!profile) redirect("/auth/onboarding");

  const groups = await listUserGroups(user.id);

  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "Groups" }]} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          A group holds channels that belong to everyone in it, at a handle of its own.
        </p>
        <CreateGroupButton />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="You're not in any groups"
          description="Start one, and the channels you make in it belong to the group rather than to you."
        >
          <CreateGroupButton />
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/${g.handle}`}
                className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent"
              >
                <UserProfilePicture avatarUrl={g.avatar_url} handle={g.handle} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{g.name}</span>
                  <span className="truncate text-xs text-muted-foreground">@{g.handle}</span>
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{g.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
