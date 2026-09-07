"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useId, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { PlusIcon } from "lucide-react";
import {
  createChannelAction,
  createGroupChannelAction,
  getMyProfileAction,
  listMyGroupsAction,
} from "@/lib/colosseum/actions";
import type { Channel, ChannelAccess } from "@/lib/colosseum/channel";
import type { Group, GroupRole } from "@/lib/colosseum/group";
import AccessSelect from "./access-select";

// The channel metadata form. Standalone on /new it creates the channel and
// opens it; the connect and quick-add pickers embed it and pass `onCreated` to
// finish what the user was already doing instead. Anything `onCreated` throws
// is shown inline, so the picker can report a failed follow-up write here.
export default function CreateChannelForm({
  submitLabel = "Create channel",
  onCreated,
}: {
  submitLabel?: string;
  onCreated?: (channel: Channel) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ChannelAccess>("public");
  // Which owner the channel belongs to: "" is you, otherwise a group id. Only
  // groups you can manage are offered — a plain member adds to a group's
  // channels but doesn't start new ones.
  const [ownerId, setOwnerId] = useState("");
  const [groups, setGroups] = useState<(Group & { role: GroupRole })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  // Keeps the radio group's name/ids unique when a second copy of this form is
  // mounted (the nav's desktop modal and mobile drawer both render one).
  const uid = useId();

  // Loaded rather than passed in: this form is mounted from four places (the
  // /new page, the nav modal, the mobile drawer, the connect picker) and none of
  // them otherwise needs the caller's groups.
  useEffect(() => {
    let stale = false;
    listMyGroupsAction()
      .then((gs) => {
        if (!stale) setGroups(gs.filter((g) => g.role !== "member"));
      })
      .catch(() => {
        // A failed lookup just means no group option; creating for yourself,
        // which is what the form did before groups existed, still works.
      });
    return () => {
      stale = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // Either action resolves the owner server-side; the id here only picks
      // which one, and the group action re-checks that you may manage it.
      const channel = ownerId
        ? await createGroupChannelAction(ownerId, { title, description, access })
        : await createChannelAction({ title, description, access });
      if (onCreated) {
        await onCreated(channel);
        return;
      }
      // A channel lives under its owner's handle, which for a group is the
      // group's, not yours.
      const group = groups.find((g) => g.id === ownerId);
      if (group) {
        router.push(`/${group.handle}/${channel.id}`);
        return;
      }
      const userProfile = await getMyProfileAction();
      if (!userProfile) {
        router.push("/auth/onboarding");
        return;
      }
      router.push(`/${userProfile.handle}/${channel.id}`);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-title`}>Title</Label>
          <Input
            id={`${uid}-title`}
            type="text"
            placeholder=""
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Label htmlFor={`${uid}-description`}>Description</Label>
          <Input
            id={`${uid}-description`}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {groups.length > 0 ? (
            <>
              <Label htmlFor={`${uid}-owner`}>Belongs to</Label>
              <select
                id={`${uid}-owner`}
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">You</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} (@{g.handle})
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <div className="mt-2">
            <AccessSelect value={access} onChange={setAccess} idPrefix={`${uid}-access`} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive-text">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Creating channel..." : submitLabel}
          <PlusIcon />
        </Button>
      </div>
    </form>
  );
}
