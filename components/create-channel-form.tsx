"use client";

import { useRouter } from "next/navigation";
import React, { useId, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { PlusIcon } from "lucide-react";
import { createChannelAction, getMyProfileAction } from "@/lib/colosseum/actions";
import type { Channel, ChannelAccess } from "@/lib/colosseum/channel";
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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  // Keeps the radio group's name/ids unique when a second copy of this form is
  // mounted (the nav's desktop modal and mobile drawer both render one).
  const uid = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // create the channel (the action resolves the owner from the session)
      const channel = await createChannelAction({
        title: title,
        description: description,
        access: access,
      });
      if (onCreated) {
        await onCreated(channel);
        return;
      }
      // reroute to channel that was just created
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
          <div className="mt-2">
            <AccessSelect value={access} onChange={setAccess} idPrefix={`${uid}-access`} />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Creating channel..." : submitLabel}
          <PlusIcon />
        </Button>
      </div>
    </form>
  );
}
