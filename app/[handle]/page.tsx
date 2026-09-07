import Link from "next/link";
import { UserX } from "lucide-react";

import PageHeader from "@/components/page-header";
import CreateChannelButton from "@/components/create-channel-button";
import GroupSettings from "@/components/group-settings";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { buildChannelCards } from "@/components/channel-card";
import { CHANNELS_PAGE } from "@/components/channel-filter";
import { ChannelsView } from "@/components/channels-view";
import { getProfileChannels, viewerScope, viewerRoleFor } from "@/lib/colosseum/channel";
import { getChannelColumnCounts } from "@/lib/colosseum/column";
import { getGroup, listGroupMembers, roleCanManage } from "@/lib/colosseum/group";
import { getOwnerByHandle } from "@/lib/colosseum/owner";
import { getSessionUser } from "@/lib/auth";
import { UserProfilePicture } from "@/components/user-profile-picture";

// One route for both kinds of owner, because they share one handle namespace:
// /{handle} resolves to an `owner` row and renders a person or a group from it.
// The channel grid below is identical either way — the same visibility rules
// produced it — so only the header block differs.
export default async function OwnerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  // Keyed by the route's handle, not by the viewer, so the session lookup and
  // the owner lookup don't depend on each other.
  const [user, owner] = await Promise.all([getSessionUser(), getOwnerByHandle(handle)]);

  if (!owner) {
    return (
      <div className="w-full p-12 space-y-8">
        <PageHeader crumbs={[{ label: handle }]} />
        <EmptyState
          icon={UserX}
          title={`No one goes by @${handle}`}
          description="The handle may have changed, or the account may be gone."
        >
          <Button asChild variant="secondary">
            <Link href="/explore">Explore</Link>
          </Button>
        </EmptyState>
      </div>
    );
  }

  const viewer = await viewerScope(user?.id ?? null);
  const isGroup = owner.kind === "group";
  // "Yours" means different things: your own profile, or a group you can
  // administer. Both unlock the same create-channel affordance below.
  const role = viewerRoleFor(viewer, owner.id);
  const match = isGroup ? roleCanManage(role) : owner.id === viewer.ownerId;

  // Owned channels (as this viewer may see them) followed by the ones you've
  // been invited to. Metadata only — a row per channel, which is what the
  // search box, the filters, the sorts and the list view all read.
  const entries = await getProfileChannels(owner.id, handle, viewer);

  // Column counts for every channel: one grouped count(*), shared by the grid
  // cards and the list rows so the two views don't re-query, and needed in full
  // because "Column count" is one of the sorts.
  const countById = await getChannelColumnCounts(entries.map((e) => e.channel.id));

  // Only the first page gets cards. Previews are five blocks per channel plus a
  // batched screenshot lookup across every url block in them, so building them
  // for a whole collection is what makes a well-used profile slow to paint. The
  // client asks loadChannelCards for the rest as the reader scrolls.
  const gridCards = await buildChannelCards(
    entries.slice(0, CHANNELS_PAGE),
    viewer,
    countById,
    true,
  );

  const channelRows = entries.map(({ channel: c, handle: ownerHandle, memberOf }) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    access: c.access,
    private: c.private,
    created_at: c.created_at,
    count: countById.get(c.id) ?? 0,
    handle: ownerHandle,
    memberOf,
  }));

  // A group's roster is public the way a profile is — you can see who is in a
  // group without being in it. Only its managers get the editing dialog.
  const [group, members] = isGroup
    ? await Promise.all([getGroup(owner.id), listGroupMembers(owner.id)])
    : [null, []];

  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: handle }]} />
      <div className="flex flex-col space-y-4">
        <div className="flex items-start justify-between gap-4">
          <UserProfilePicture avatarUrl={owner.avatar_url} handle={owner.handle} size="xl" />
          {group && role && user && roleCanManage(role) ? (
            <GroupSettings
              group={group}
              members={members}
              viewerRole={role}
              viewerUserId={user.id}
            />
          ) : null}
        </div>
        {group ? (
          <div className="flex flex-col">
            <h2 className="text-label">Group</h2>
            <p>{group.name}</p>
          </div>
        ) : null}
        <div className="flex flex-col">
          {owner.about ? (
            <>
              <h2 className="text-label">About</h2>
              <p className="">{owner.about}</p>
            </>
          ) : null}
        </div>
        {group ? (
          <div className="flex flex-col">
            <h2 className="text-label">Members</h2>
            <ul className="flex flex-wrap gap-2">
              {members.map((m) => (
                <li key={m.user_id}>
                  <Link
                    href={`/${m.handle}`}
                    className="flex items-center gap-1.5 text-sm hover:underline"
                  >
                    <UserProfilePicture avatarUrl={m.avatar_url} handle={m.handle} size="sm" />
                    <span>@{m.handle}</span>
                    {m.role !== "member" ? <span className="text-caption">{m.role}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col">
          <h2 className="text-label">{isGroup ? "Created" : "Joined"}</h2>
          <p>
            {new Date(owner.created_at).toLocaleString("default", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="w-full flex items-center justify-center">
          <div className="w-1/2 flex flex-col space-y-4 items-center">
            <h1 className="text-display">
              {isGroup
                ? `Looks like ${match ? "you have" : "they have"} no channels here yet.`
                : `Looks like ${match ? "you" : "they"} have no channels.`}
            </h1>
            {match ? <CreateChannelButton /> : null}
          </div>
        </div>
      ) : (
        <ChannelsView
          isOwner={match}
          handle={handle}
          gridCards={gridCards}
          channels={channelRows}
        />
      )}
    </div>
  );
}
