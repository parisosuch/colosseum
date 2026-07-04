import { readFile } from "node:fs/promises";
import path from "node:path";

export type ChangelogSection = { title: string; items: string[] };
export type ChangelogRelease = {
  version: string;
  date?: string;
  // Free text between the release heading and its first `###` section, e.g.
  // "Initial public release."
  note?: string;
  sections: ChangelogSection[];
};

// Parse a Keep a Changelog document. We author this file, so the parser only
// handles the structure we actually use: `## [version] - date` releases,
// `### Section` groups, and `- item` bullets (a bullet may wrap onto indented
// continuation lines). Anything before the first release heading (the title and
// intro) is ignored.
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();

    if (raw.startsWith("## ")) {
      const m = line.match(/^##\s+\[?([^\]\s]+)\]?(?:\s*-\s*(.+))?$/);
      release = { version: m ? m[1] : line.slice(3).trim(), date: m?.[2]?.trim(), sections: [] };
      section = null;
      releases.push(release);
      continue;
    }
    if (!release) continue;

    if (raw.startsWith("### ")) {
      section = { title: line.slice(4).trim(), items: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet && section) {
      section.items.push(bullet[1].trim());
      continue;
    }

    if (!line) continue;

    // Indented continuation of the previous bullet (a wrapped line).
    if (section && section.items.length && /^\s/.test(raw)) {
      section.items[section.items.length - 1] += " " + line;
      continue;
    }

    // Otherwise it's the release's free-text note.
    if (!section) {
      release.note = release.note ? release.note + " " + line : line;
    }
  }

  return releases;
}

export async function getChangelog(): Promise<ChangelogRelease[]> {
  const markdown = await readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  return parseChangelog(markdown);
}
