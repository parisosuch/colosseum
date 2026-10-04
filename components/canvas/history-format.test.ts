import { describe, expect, test } from "bun:test";

import type { CanvasVersion } from "@/lib/colosseum/canvas-version";
import {
  dayLabel,
  editorsLine,
  formatSize,
  formatTime,
  formatWhen,
  groupVersions,
  initials,
  previewSubtitle,
  restoreTarget,
  savedByLine,
  versionLabel,
} from "./history-format";

// Local-time constructors, so the tests hold in any TZ.
const NOW = new Date(2026, 9, 3, 15, 50);

function version(at: Date, patch: Partial<CanvasVersion> = {}): CanvasVersion {
  return {
    id: 1,
    name: null,
    created_at: at.toISOString(),
    created_by: null,
    editors: [],
    size: 0,
    ...patch,
  };
}

describe("formatTime", () => {
  test("12-hour clock with a lowercase suffix", () => {
    expect(formatTime(new Date(2026, 9, 3, 15, 42))).toBe("3:42 pm");
    expect(formatTime(new Date(2026, 9, 3, 11, 5))).toBe("11:05 am");
  });
  test("midnight and noon are 12", () => {
    expect(formatTime(new Date(2026, 9, 3, 0, 0))).toBe("12:00 am");
    expect(formatTime(new Date(2026, 9, 3, 12, 30))).toBe("12:30 pm");
  });
});

describe("dayLabel", () => {
  test("today and yesterday by calendar day, not 24 hours", () => {
    expect(dayLabel(new Date(2026, 9, 3, 0, 1), NOW)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 2, 23, 59), NOW)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 2, 0, 0), NOW)).toBe("Yesterday");
  });
  test("older days this year drop the year", () => {
    expect(dayLabel(new Date(2026, 8, 28, 9, 0), NOW)).toBe("Sep 28");
  });
  test("another year keeps it", () => {
    expect(dayLabel(new Date(2025, 11, 31, 9, 0), NOW)).toBe("Dec 31, 2025");
  });
  test("yesterday across a month boundary", () => {
    expect(dayLabel(new Date(2026, 8, 30, 22, 0), new Date(2026, 9, 1, 1, 0))).toBe("Yesterday");
  });
});

describe("formatWhen", () => {
  test("day and time", () => {
    expect(formatWhen(new Date(2026, 9, 2, 16, 12), NOW)).toBe("Yesterday, 4:12 pm");
    expect(formatWhen(new Date(2026, 8, 1, 9, 3), NOW)).toBe("Sep 1, 9:03 am");
  });
});

describe("groupVersions", () => {
  test("one group per day, in the order given", () => {
    const list = [
      version(new Date(2026, 9, 3, 15, 42), { id: 5 }),
      version(new Date(2026, 9, 3, 11, 5), { id: 4 }),
      version(new Date(2026, 9, 2, 16, 12), { id: 3 }),
      version(new Date(2026, 9, 2, 10, 30), { id: 2 }),
      version(new Date(2026, 8, 20, 10, 30), { id: 1 }),
    ];
    const groups = groupVersions(list, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Sep 20"]);
    expect(groups.map((g) => g.versions.map((v) => v.id))).toEqual([[5, 4], [3, 2], [1]]);
  });
  test("nothing gives no groups", () => {
    expect(groupVersions([], NOW)).toEqual([]);
  });
});

describe("row text", () => {
  const at = new Date(2026, 9, 3, 14, 10);
  test("a named point says who saved it", () => {
    expect(savedByLine(version(at, { name: "Before", created_by: "paris" }))).toBe(
      "2:10 pm · saved by paris",
    );
  });
  test("a deleted saver leaves only the time", () => {
    expect(savedByLine(version(at, { name: "Before" }))).toBe("2:10 pm");
  });
  test("editors in order", () => {
    expect(editorsLine(["paris", "pola", "kev"])).toBe("paris, pola, kev");
  });
  test("preview subtitle with and without editors", () => {
    expect(previewSubtitle(version(at, { editors: ["paris", "kev"] }))).toBe(
      "Read-only preview · edited by paris, kev",
    );
    expect(previewSubtitle(version(at))).toBe("Read-only preview");
  });
  test("accessible labels name the kind", () => {
    expect(versionLabel(version(at, { editors: ["kev"] }), NOW)).toBe(
      "Automatic version, Today, 2:10 pm, edited by kev",
    );
    expect(versionLabel(version(at, { name: "Kit pick" }), NOW)).toBe(
      "Restore point “Kit pick”, Today, 2:10 pm",
    );
  });
  test("what a restore goes back to", () => {
    expect(restoreTarget(version(at, { name: "Kit pick" }), NOW)).toBe(
      "the restore point “Kit pick”",
    );
    expect(restoreTarget(version(new Date(2026, 9, 2, 16, 12)), NOW)).toBe(
      "how it was yesterday at 4:12 pm",
    );
    expect(restoreTarget(version(new Date(2026, 8, 28, 9, 3)), NOW)).toBe(
      "how it was on Sep 28 at 9:03 am",
    );
  });
  test("initials and sizes", () => {
    expect(initials("pola")).toBe("PO");
    expect(initials("k")).toBe("K");
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(860_000)).toBe("840 KB");
    expect(formatSize(2_400_000)).toBe("2.3 MB");
  });
});
