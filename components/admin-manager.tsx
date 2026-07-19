"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Send,
  Shield,
  ShieldOff,
  Undo2,
} from "lucide-react";

import {
  getAppSettingsAction,
  sendTestEmailAction,
  setUserAdminAction,
  setUserBannedAction,
  setUserLimitsAction,
  updateAppSettingsAction,
} from "@/lib/colosseum/actions";
import type { AdminUser, AppSettings } from "@/lib/colosseum/admin";
import type { EmailSettings } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// "" ⇄ null; otherwise a non-negative integer. Anything invalid becomes null
// (unlimited) rather than throwing — the field is a convenience, not a form gate.
function toLimit(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function fromLimit(value: number | null): string {
  return value === null ? "" : String(value);
}

type SortKey = "handle" | "invites" | "columns";
const PAGE_SIZE = 20;

// Icon-only action button with the label surfaced as a tooltip (and as the
// accessible name). Used for the dense per-user row so it stays compact.
function IconAction({
  icon,
  label,
  onClick,
  variant = "secondary",
  className,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "secondary" | "outline";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className={className}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Password field with a show/hide toggle — reveals the saved secret so an admin
// can verify or copy it, or check a new key while typing.
function SecretInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        className="w-full pr-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide" : "Show"}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export default function AdminManager({
  currentUserId,
  initialSettings,
  initialUsers,
}: {
  currentUserId: string;
  initialSettings: AppSettings;
  initialUsers: AdminUser[];
}) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [error, setError] = useState<string | null>(null);

  // Last-saved limits per user, so the row's Save stays disabled until its
  // invite/column inputs actually differ from what's persisted.
  const [savedLimits, setSavedLimits] = useState(
    () =>
      new Map(
        initialUsers.map((u) => [
          u.user_id,
          { invite_limit: u.invite_limit, column_limit: u.column_limit },
        ]),
      ),
  );
  const limitsDirty = (u: AdminUser) => {
    const base = savedLimits.get(u.user_id);
    return !base || base.invite_limit !== u.invite_limit || base.column_limit !== u.column_limit;
  };

  // Client-side search / sort / paging over the loaded list.
  // ponytail: the page loads every user up front, so this is all in-memory — no
  // extra round-trips. Move to server-side paging if an instance ever grows past
  // a few thousand accounts.
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("handle");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "handle" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? users.filter(
          (u) => u.handle?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
        )
      : users;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "handle") return dir * (a.handle ?? "").localeCompare(b.handle ?? "");
      if (sortKey === "invites") return dir * (a.invites_used - b.invites_used);
      return dir * (a.columns_used - b.columns_used);
    });
  }, [users, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Global limits form. `savedSettings` is the last-persisted value, so Save
  // stays disabled until an input semantically differs from it.
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [invitesGlobal, setInvitesGlobal] = useState(
    fromLimit(initialSettings.max_invites_per_user),
  );
  const [columnsGlobal, setColumnsGlobal] = useState(
    fromLimit(initialSettings.max_columns_per_user),
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  // Email config. Secrets arrive blank (redacted); an edited field overwrites,
  // a blank one keeps what's stored. Compared as JSON for the dirty check.
  const [email, setEmail] = useState<EmailSettings>(initialSettings.email);
  const [savedEmail, setSavedEmail] = useState(initialSettings.email);
  const patchEmail = (patch: Partial<EmailSettings>) => setEmail((e) => ({ ...e, ...patch }));

  const settingsDirty =
    toLimit(invitesGlobal) !== savedSettings.max_invites_per_user ||
    toLimit(columnsGlobal) !== savedSettings.max_columns_per_user ||
    JSON.stringify(email) !== JSON.stringify(savedEmail);

  const saveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      await updateAppSettingsAction({
        max_invites_per_user: toLimit(invitesGlobal),
        max_columns_per_user: toLimit(columnsGlobal),
        email,
      });
      const fresh = await getAppSettingsAction();
      setSavedSettings(fresh);
      setInvitesGlobal(fromLimit(fresh.max_invites_per_user));
      setColumnsGlobal(fromLimit(fresh.max_columns_per_user));
      setEmail(fresh.email);
      setSavedEmail(fresh.email);
    } catch (e) {
      console.error(e);
      setError("Couldn't save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  // Sends a test email to the signed-in admin using the saved config, so the
  // provider can be verified end-to-end. Uses what's persisted, not the current
  // form — hence disabled while there are unsaved changes.
  const sendTest = async () => {
    setTestingEmail(true);
    try {
      const sentTo = await sendTestEmailAction();
      toast.success(`Test email sent to ${sentTo}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send test email.");
    } finally {
      setTestingEmail(false);
    }
  };

  const patchUser = (userId: string, patch: Partial<AdminUser>) =>
    setUsers((us) => us.map((u) => (u.user_id === userId ? { ...u, ...patch } : u)));

  const run = async (fn: () => Promise<void>, onError: string) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : onError);
    }
  };

  const toggleBan = (u: AdminUser) =>
    run(async () => {
      await setUserBannedAction(u.user_id, !u.banned);
      patchUser(u.user_id, { banned: !u.banned });
    }, "Couldn't update ban status.");

  const toggleAdmin = (u: AdminUser) =>
    run(async () => {
      await setUserAdminAction(u.user_id, !u.is_admin);
      patchUser(u.user_id, { is_admin: !u.is_admin });
    }, "Couldn't update admin status.");

  const saveLimits = (u: AdminUser) =>
    run(async () => {
      const limits = { invite_limit: u.invite_limit, column_limit: u.column_limit };
      await setUserLimitsAction(u.user_id, limits);
      setSavedLimits((m) => new Map(m).set(u.user_id, limits));
    }, "Couldn't save limits.");

  return (
    <TooltipProvider>
      <div className="space-y-10">
        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        {/* Global limits */}
        <section className="space-y-4">
          <h2 className="text-heading">Global limits</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="invites-global">Invites per user</Label>
              <Input
                id="invites-global"
                inputMode="numeric"
                className="w-40"
                placeholder="unlimited"
                value={invitesGlobal}
                onChange={(e) => setInvitesGlobal(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="columns-global">Columns per user</Label>
              <Input
                id="columns-global"
                inputMode="numeric"
                className="w-40"
                placeholder="unlimited"
                value={columnsGlobal}
                onChange={(e) => setColumnsGlobal(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Outbound email */}
        <section className="space-y-4">
          <h2 className="text-heading">Email</h2>
          <p className="text-caption max-w-prose">
            Used for password resets and notifications. Choose a provider and save — while it’s off,
            no email is sent. Secrets are write-only: leave a saved field blank to keep it.
          </p>
          <div className="max-w-sm space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email-provider">Provider</Label>
              <select
                id="email-provider"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={email.provider ?? ""}
                onChange={(e) =>
                  patchEmail({
                    provider: (e.target.value || null) as EmailSettings["provider"],
                  })
                }
              >
                <option value="">Off — don’t send email</option>
                <option value="resend">Resend</option>
                <option value="smtp">SMTP</option>
              </select>
            </div>

            {email.provider !== null ? (
              <div className="space-y-1">
                <Label htmlFor="email-from">From</Label>
                <Input
                  id="email-from"
                  className="w-full"
                  placeholder="Colosseum <noreply@your-domain.com>"
                  value={email.from}
                  onChange={(e) => patchEmail({ from: e.target.value })}
                />
              </div>
            ) : null}

            {email.provider === "resend" ? (
              <div className="space-y-1">
                <Label htmlFor="resend-key">Resend API key</Label>
                <SecretInput
                  id="resend-key"
                  placeholder="re_..."
                  value={email.resend_api_key}
                  onChange={(v) => patchEmail({ resend_api_key: v })}
                />
              </div>
            ) : null}

            {email.provider === "smtp" ? (
              <>
                <div className="grid grid-cols-[1fr_5rem] gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="smtp-host">Host</Label>
                    <Input
                      id="smtp-host"
                      className="w-full"
                      placeholder="smtp.example.com"
                      value={email.smtp_host}
                      onChange={(e) => patchEmail({ smtp_host: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input
                      id="smtp-port"
                      inputMode="numeric"
                      className="w-full"
                      placeholder="587"
                      value={email.smtp_port === null ? "" : String(email.smtp_port)}
                      onChange={(e) => patchEmail({ smtp_port: toLimit(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="smtp-user">Username</Label>
                    <Input
                      id="smtp-user"
                      className="w-full"
                      placeholder="optional"
                      value={email.smtp_user}
                      onChange={(e) => patchEmail({ smtp_user: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="smtp-pass">Password</Label>
                    <SecretInput
                      id="smtp-pass"
                      placeholder="optional"
                      value={email.smtp_pass}
                      onChange={(v) => patchEmail({ smtp_pass: v })}
                    />
                  </div>
                </div>
              </>
            ) : null}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={saveSettings}
                disabled={savingSettings || !settingsDirty}
              >
                <Check />
                {savingSettings ? "Saving..." : "Save settings"}
              </Button>
              <Button
                variant="outline"
                onClick={sendTest}
                disabled={testingEmail || settingsDirty || savedEmail.provider === null}
                title={
                  settingsDirty
                    ? "Save your changes first"
                    : savedEmail.provider === null
                      ? "Turn on a provider first"
                      : undefined
                }
              >
                <Send />
                {testingEmail ? "Sending..." : "Send test"}
              </Button>
            </div>
          </div>
        </section>

        {/* Users */}
        <section className="space-y-4">
          <h2 className="text-heading">Users</h2>

          {/* One toolbar row: sort controls left, search right, aligned. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Sort:</span>
              {(
                [
                  ["handle", "Username"],
                  ["invites", "Invites"],
                  ["columns", "Columns"],
                ] as [SortKey, string][]
              ).map(([key, label]) => {
                const active = sortKey === key;
                const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <Button
                    key={key}
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    <Icon />
                  </Button>
                );
              })}
            </div>
            <Input
              className="w-full sm:w-64"
              placeholder="Search by handle or email"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>

          <ul className="flex flex-col divide-y rounded-lg border">
            {pageItems.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">No users match “{query}”.</li>
            ) : null}
            {pageItems.map((u) => (
              <li key={u.user_id} className="flex flex-wrap items-center justify-between gap-4 p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    {u.handle ? (
                      <Link href={`/${u.handle}`} className="font-medium underline">
                        @{u.handle}
                      </Link>
                    ) : (
                      <span className="font-medium text-muted-foreground">(no handle)</span>
                    )}
                    {u.is_admin ? <Badge variant="secondary">admin</Badge> : null}
                    {u.banned ? <Badge variant="destructive">banned</Badge> : null}
                  </span>
                  <span className="text-caption truncate">{u.email}</span>
                  <span className="text-caption tabular-nums">
                    {u.invites_used} invites · {u.columns_used} columns
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`inv-${u.user_id}`}>
                      Invite limit
                    </Label>
                    <Input
                      id={`inv-${u.user_id}`}
                      inputMode="numeric"
                      className="w-24"
                      placeholder="default"
                      value={fromLimit(u.invite_limit)}
                      onChange={(e) =>
                        patchUser(u.user_id, { invite_limit: toLimit(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`col-${u.user_id}`}>
                      Column limit
                    </Label>
                    <Input
                      id={`col-${u.user_id}`}
                      inputMode="numeric"
                      className="w-24"
                      placeholder="default"
                      value={fromLimit(u.column_limit)}
                      onChange={(e) =>
                        patchUser(u.user_id, { column_limit: toLimit(e.target.value) })
                      }
                    />
                  </div>
                  <IconAction
                    icon={<Check />}
                    label="Save limits"
                    variant="default"
                    disabled={!limitsDirty(u)}
                    onClick={() => saveLimits(u)}
                  />
                  <IconAction
                    icon={u.is_admin ? <ShieldOff /> : <Shield />}
                    label={u.is_admin ? "Remove admin" : "Make admin"}
                    onClick={() => toggleAdmin(u)}
                  />
                  {u.user_id === currentUserId ? null : (
                    <IconAction
                      icon={u.banned ? <Undo2 /> : <Ban />}
                      label={u.banned ? "Unban" : "Ban"}
                      variant="outline"
                      className={u.banned ? "" : "text-destructive hover:text-destructive"}
                      onClick={() => toggleBan(u)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageItems.length} of{" "}
                {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  <ChevronLeft />
                  Prev
                </Button>
                <span className="text-muted-foreground">
                  Page {safePage + 1} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </TooltipProvider>
  );
}
