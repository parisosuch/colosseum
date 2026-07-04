import { expect, test } from "bun:test";

import { parseChangelog } from "./changelog";

test("parses versions, dates, sections, notes, and wrapped bullets", () => {
  const md = `# Changelog

Intro paragraph that should be ignored.

## [Unreleased]

## [1.2.0] - 2026-01-02

Initial public release.

### Added

- A thing that wraps
  onto a second line.
- Another thing with a [link](https://x.y) and \`code\`.

### Fixed

- One fix.
`;

  const releases = parseChangelog(md);

  expect(releases.map((r) => r.version)).toEqual(["Unreleased", "1.2.0"]);

  const v = releases[1];
  expect(v.date).toBe("2026-01-02");
  expect(v.note).toBe("Initial public release.");
  expect(v.sections.map((s) => s.title)).toEqual(["Added", "Fixed"]);
  expect(v.sections[0].items[0]).toBe("A thing that wraps onto a second line.");
  expect(v.sections[0].items[1]).toContain("[link](https://x.y)");
  expect(v.sections[1].items).toEqual(["One fix."]);
});
