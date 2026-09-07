"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettingsIcon } from "lucide-react";

import { deleteGroupAction, updateGroupAction } from "@/lib/colosseum/actions";
import type { Group, GroupMember, GroupRole } from "@/lib/colosseum/group";
import GroupMembers from "./group-members";
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
  const [members, setMembers] = useState(initialMembers);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // The viewer's own role can change under them: transferring ownership demotes
  // them to admin without a reload, so read it back from the roster.
  const currentRole = members.find((m) => m.user_id === viewerUserId)?.role ?? viewerRole;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateGroupAction(group.id, { name, about });
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
                  <Button variant="destructive" disabled={deleting}>
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
