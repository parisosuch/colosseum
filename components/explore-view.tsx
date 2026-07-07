import Link from "next/link";

import type { UserProfile } from "@/lib/colosseum/user";
import PageHeader from "@/components/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function UserCard({ user }: { user: UserProfile }) {
  return (
    <Link
      href={`/${user.handle}`}
      className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <Avatar className="size-10 shrink-0">
        <AvatarImage src={user.avatar_url} />
        <AvatarFallback>{user.handle.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">@{user.handle}</p>
        {user.about ? <p className="truncate text-sm text-muted-foreground">{user.about}</p> : null}
      </div>
    </Link>
  );
}

function UserGrid({ users }: { users: UserProfile[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {users.map((user) => (
        <UserCard key={user.user_id} user={user} />
      ))}
    </div>
  );
}

// The explore page (the app's home for signed-in users). Colosseum is invite-
// only, so everyone traces back to the same root through invites — the whole
// membership is one network. Explore shows everyone, with the people you
// invited (or who invited you) leading as "Friends".
export default function ExploreView({
  friends,
  everyoneElse,
}: {
  friends: UserProfile[];
  everyoneElse: UserProfile[];
}) {
  const empty = friends.length === 0 && everyoneElse.length === 0;

  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto p-6 sm:p-12 space-y-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <PageHeader crumbs={[{ label: "Explore" }]} />
      <div className="space-y-1">
        <h1 className="text-display">Explore</h1>
        <p className="text-muted-foreground">
          Everyone on Colosseum — you&apos;re all connected through invites.
        </p>
      </div>

      {empty ? (
        <p className="text-muted-foreground">No one else is here yet.</p>
      ) : (
        <>
          {friends.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-label">Friends</h2>
              <UserGrid users={friends} />
            </section>
          ) : null}
          {everyoneElse.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-label">{friends.length > 0 ? "Everyone else" : "Everyone"}</h2>
              <UserGrid users={everyoneElse} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
