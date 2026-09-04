"use client";

import { useState } from "react";
import { toast } from "sonner";

import { setEmailNotificationPrefAction } from "@/lib/colosseum/actions";
import type { EmailNotificationPrefs } from "@/lib/db/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// One row per notification type; the key matches the `type` enum. In-app
// notifications are always recorded — these only gate the emails.
const TYPES: { key: keyof EmailNotificationPrefs; label: string }[] = [
  { key: "comment", label: "Comments on your blocks" },
  { key: "mention", label: "Mentions of you in comments" },
  { key: "connect", label: "Connections to your channels" },
  { key: "member", label: "Being added to a channel" },
];

export default function NotificationSettings({ initial }: { initial: EmailNotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<keyof EmailNotificationPrefs | null>(null);

  const toggle = async (key: keyof EmailNotificationPrefs, next: boolean) => {
    setPrefs((p) => ({ ...p, [key]: next }));
    setSaving(key);
    try {
      setPrefs(await setEmailNotificationPrefAction(key, next));
      toast.success("Notification preferences saved.");
    } catch {
      setPrefs((p) => ({ ...p, [key]: !next }));
      toast.error("Couldn't save that.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-heading">Email notifications</h2>
      <p className="text-caption max-w-prose">
        Choose which notifications also reach your inbox. They always show up in the app.
      </p>
      {/* The whole row is the hit area: a 16px checkbox is nowhere near a touch
          target, so the Label wraps the row and carries the height. */}
      <div className="max-w-prose">
        {TYPES.map(({ key, label }) => (
          <Label
            key={key}
            htmlFor={`notif-${key}`}
            className="-mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
          >
            <Checkbox
              id={`notif-${key}`}
              checked={prefs[key]}
              disabled={saving === key}
              onCheckedChange={(c) => toggle(key, c === true)}
            />
            <span className="flex-1">{label}</span>
          </Label>
        ))}
      </div>
    </section>
  );
}
