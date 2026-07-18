"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Shield,
  ShieldOff,
  Undo2,
} from "lucide-react";

import {
  getAppSettingsAction,
  setUserAdminAction,
  setUserBannedAction,
  setUserLimitsAction,
  updateAppSettingsAction,
} from "@/lib/colosseum/actions";
import type { AdminUser, AppSettings } from "@/lib/colosseum/admin";
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
  const settingsDirty =
    toLimit(invitesGlobal) !== savedSettings.max_invites_per_user ||
    toLimit(columnsGlobal) !== savedSettings.max_columns_per_user;

  const saveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      await updateAppSettingsAction({
        max_invites_per_user: toLimit(invitesGlobal),
        max_columns_per_user: toLimit(columnsGlobal),
      });
      const fresh = await getAppSettingsAction();
      setSavedSettings(fresh);
      setInvitesGlobal(fromLimit(fresh.max_invites_per_user));
      setColumnsGlobal(fromLimit(fresh.max_columns_per_user));
    } catch (e) {
      console.error(e);
      setError("Couldn't save settings.");
    } finally {
      setSavingSettings(false);
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
            <Button onClick={saveSettings} disabled={savingSettings || !settingsDirty}>
              <Check />
              {savingSettings ? "Saving..." : "Save limits"}
            </Button>
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
