"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateUserProfileAction, uploadAvatarAction } from "@/lib/colosseum/actions";
import { normalizeHandle, validateHandle } from "@/lib/colosseum/handle";
import type { UserProfile } from "@/lib/colosseum/user";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function EditProfileForm({ profile }: { profile: UserProfile }) {
  const [handle, setHandle] = useState(profile.handle);
  const [about, setAbout] = useState(profile.about ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatar_url ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // The server actions below resolve the caller from their session; no
      // client-side auth check is needed here.
      const normalized = normalizeHandle(handle);
      const validationError = validateHandle(normalized);
      if (validationError) {
        toast.error(validationError);
        return;
      }

      let avatar_url: string | undefined = profile.avatar_url;

      if (avatarFile) {
        // Content-addressed blob storage: a changed image gets a new URL, so
        // the nav bar picks it up without any cache-busting query.
        const formData = new FormData();
        formData.set("file", avatarFile);
        const { url } = await uploadAvatarAction(formData);
        avatar_url = url;
      }

      const updates: { handle?: string; about?: string; avatar_url?: string } = {};
      if (normalized !== profile.handle) updates.handle = normalized;
      if (about !== (profile.about ?? "")) updates.about = about;
      if (avatar_url !== profile.avatar_url) updates.avatar_url = avatar_url;

      if (Object.keys(updates).length > 0) {
        const result = await updateUserProfileAction(updates);
        if (!result.ok) {
          toast.error(result.handleTaken ? "That handle is already taken." : result.message);
          return;
        }
      }

      toast.success("Profile saved.");

      // If the handle changed, navigate to the new profile URL.
      if (normalized !== profile.handle) {
        window.location.assign(`/${normalized}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  // Save stays disabled until something actually changes, so it reads as the
  // profile form's own control (the notification toggles below save instantly).
  const dirty =
    normalizeHandle(handle) !== profile.handle ||
    about !== (profile.about ?? "") ||
    avatarFile !== null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-md">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          <AvatarImage src={avatarPreview ?? undefined} />
          <AvatarFallback>{handle.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          Change
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="handle">Handle</Label>
        <Input
          id="handle"
          type="text"
          value={handle}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setHandle(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="about">About</Label>
        <Textarea
          id="about"
          value={about}
          placeholder="Tell people a bit about yourself"
          onChange={(e) => setAbout(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={isLoading || !dirty}>
        {isLoading ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
