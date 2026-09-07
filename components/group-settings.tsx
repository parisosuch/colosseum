"use client";

import { useRouter } from "next/navigation";
import React, { useRef, useState } from "react";
import { SettingsIcon } from "lucide-react";

import { deleteGroupAction, updateGroupAction, uploadAvatarAction } from "@/lib/colosseum/actions";
import type { Group, GroupMember, GroupRole } from "@/lib/colosseum/group";
import GroupMembers from "./group-members";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// The group's manage dialog: name and bio, the roster, and — for the owner
// alone — deleting the whole thing. Rendered only for owner/admin, which the
// server re-checks on every action here, so this is presentation rather than
// the gate.
export default function GroupSettings({
  group,
  members: initialMembers,
  viewerRole,
  viewerUserId,
}: {
  group: Group;
  members: GroupMember[];
  viewerRole: GroupRole;
  viewerUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [about, setAbout] = useState(group.about ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(group.avatar_url ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState(initialMembers);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The viewer's own role can change under them: transferring ownership demotes
  // them to admin without a reload, so read it back from the roster.
  const currentRole = members.find((m) => m.user_id === viewerUserId)?.role ?? viewerRole;

  // Previewed locally and uploaded on save, the same shape the profile editor
  // uses — so cancelling out of the dialog leaves no orphaned blob behind.
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let avatar_url: string | undefined = group.avatar_url;
      if (avatarFile) {
        const formData = new FormData();
        formData.set("file", avatarFile);
        ({ url: avatar_url } = await uploadAvatarAction(formData));
      }
      await updateGroupAction(group.id, {
        name,
        about,
        ...(avatar_url !== group.avatar_url ? { avatar_url } : {}),
      });
      setAvatarFile(null);
      router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save those changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteGroupAction(group.id);
      router.push("/explore");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the group.");
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <SettingsIcon />
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage {group.name}</DialogTitle>
          <DialogDescription>@{group.handle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={avatarPreview ?? undefined} />
              <AvatarFallback>{group.handle.charAt(0).toUpperCase()}</AvatarFallback>
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
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Label htmlFor="group-about">About</Label>
            <Textarea id="group-about" value={about} onChange={(e) => setAbout(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive-text">{error}</p>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>

          <GroupMembers
            groupId={group.id}
            members={members}
            setMembers={setMembers}
            viewerRole={currentRole}
            viewerUserId={viewerUserId}
          />

          {/* Deleting takes the group's channels with it, so it is the owner's
              call alone — an admin does not see this at all. */}
          {currentRole === "owner" ? (
            <div className="border-t pt-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    // Red type on a transparent ground: the fill pair is for the
                    // confirm button inside the dialog, not the affordance that
                    // opens it. Matches the channel delete trigger.
                    className="border-destructive bg-transparent text-destructive-text shadow-none hover:bg-destructive/10 hover:text-destructive-text"
                    disabled={deleting}
                  >
                    Delete group
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {group.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every channel the group owns is deleted with it, along with the blocks in
                      them. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
