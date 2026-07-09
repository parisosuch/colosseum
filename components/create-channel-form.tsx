"use client";

import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { PlusIcon } from "lucide-react";
import { createChannelAction, getMyProfileAction } from "@/lib/colosseum/actions";
import type { ChannelAccess } from "@/lib/colosseum/channel";
import AccessSelect from "./access-select";

export default function CreateChannelForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ChannelAccess>("public");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

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
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            type="text"
            placeholder=""
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="mt-2">
            <AccessSelect value={access} onChange={setAccess} idPrefix="create-access" />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Creating channel..." : "Create channel"}
          <PlusIcon />
        </Button>
      </div>
    </form>
  );
}
