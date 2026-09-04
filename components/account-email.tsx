"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The account's email: what it is, whether anyone has proven they own it, and
// how to correct it. Sign-up takes the address on trust, so this is the only
// place a typo in the one channel that can recover the account gets fixed.
export default function AccountEmail({ email, verified }: { email: string; verified: boolean }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState(email);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const resend = async () => {
    setBusy(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/settings",
      });
      if (error) throw new Error(error.message ?? "Couldn't send the confirmation email.");
      toast.success(`Confirmation sent to ${email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the confirmation email.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = newEmail.trim();
    if (!target || target === email) {
      setEditing(false);
      setNewEmail(email);
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.changeEmail({
        newEmail: target,
        callbackURL: "/settings",
      });
      if (error) throw new Error(error.message ?? "Couldn't change the email.");
      setEditing(false);
      // An unverified address changes on the spot; a verified one waits for the
      // old inbox to approve it, so say which of the two just happened.
      if (verified) {
        toast.success(`Check ${email} to approve the change to ${target}.`);
      } else {
        toast.success(`Email changed to ${target}. A confirmation is on its way to it.`);
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-heading">Email</h2>
      <p className="text-caption max-w-prose">
        Password resets and notifications go here. It is the only way back into the account, so keep
        it one you can read.
      </p>
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <Label htmlFor="account-email">New email</Label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setNewEmail(email);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p>
            {email}{" "}
            <span className="text-caption">{verified ? "· confirmed" : "· not confirmed yet"}</span>
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change email
            </Button>
            {!verified && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={resend}>
                {busy ? "Sending..." : "Resend confirmation"}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
