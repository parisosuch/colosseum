// Labels for the version history panel and the preview bar. Pure, so the
// grouping and wording are tested without a browser. Times are in the
// viewer's local zone; `now` is passed in so "Today" and "Yesterday" are
// stable under test.

import type { CanvasVersion } from "@/lib/colosseum/canvas-version";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Whole calendar days between two instants, local time: 0 for the same day, 1
// for yesterday. Rounded, so a 23- or 25-hour DST day still counts as one.
function daysBefore(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

// "3:42 pm", as the design sets it.
export function formatTime(date: Date): string {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

// The heading a version sits under: "Today", "Yesterday", "Sep 28", or
// "Sep 28, 2025" outside this year.
export function dayLabel(date: Date, now: Date): string {
  const days = daysBefore(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const md = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? md : `${md}, ${date.getFullYear()}`;
}

// The preview bar's title: "Yesterday, 4:12 pm".
export function formatWhen(date: Date, now: Date): string {
  return `${dayLabel(date, now)}, ${formatTime(date)}`;
}

// The version a restore goes back to, mid-sentence: "the restore point
// “Kit pick”", "how it was yesterday at 4:12 pm", "how it was on Sep 28 at
// 9:03 am".
export function restoreTarget(v: CanvasVersion, now: Date): string {
  if (v.name) return `the restore point “${v.name}”`;
  const date = new Date(v.created_at);
  const day = dayLabel(date, now);
  const on = day === "Today" || day === "Yesterday" ? day.toLowerCase() : `on ${day}`;
  return `how it was ${on} at ${formatTime(date)}`;
}

export type VersionGroup = { label: string; versions: CanvasVersion[] };

// Newest-first versions under one heading per local day, in the order given.
export function groupVersions(versions: readonly CanvasVersion[], now: Date): VersionGroup[] {
  const groups: VersionGroup[] = [];
  for (const v of versions) {
    const label = dayLabel(new Date(v.created_at), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.versions.push(v);
    else groups.push({ label, versions: [v] });
  }
  return groups;
}

// The line under a named restore point: "2:10 pm · saved by paris". A deleted
// account leaves only the time.
export function savedByLine(v: CanvasVersion): string {
  const time = formatTime(new Date(v.created_at));
  return v.created_by ? `${time} · saved by ${v.created_by}` : time;
}

// Who edited, as a sentence fragment: "paris, pola, kev".
export function editorsLine(editors: readonly string[]): string {
  return editors.join(", ");
}

// The preview bar's second line.
export function previewSubtitle(v: CanvasVersion): string {
  return v.editors.length > 0
    ? `Read-only preview · edited by ${editorsLine(v.editors)}`
    : "Read-only preview";
}

// What a screen reader hears for a row, since its visible title is only a
// time for automatic versions.
export function versionLabel(v: CanvasVersion, now: Date): string {
  const when = formatWhen(new Date(v.created_at), now);
  const kind = v.name ? `Restore point “${v.name}”` : "Automatic version";
  const who = v.editors.length > 0 ? `, edited by ${editorsLine(v.editors)}` : "";
  return `${kind}, ${when}${who}`;
}

// Two letters for an initials avatar.
export function initials(handle: string): string {
  return handle.slice(0, 2).toUpperCase();
}

// A doc's size for the row's tooltip: "840 KB", "2.3 MB".
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
