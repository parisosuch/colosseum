import type { ReactNode } from "react";

import PageHeader from "@/components/page-header";
import { getChangelog } from "@/lib/changelog";

// Minimal inline markdown: [text](url) links and `code`. The changelog is our
// own content, so this is all it needs.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    if (m[1]) {
      nodes.push(
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          {m[1]}
        </a>,
      );
    } else {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
          {m[3]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

export default async function ChangelogPage() {
  // Hide an empty Unreleased section until it has entries.
  const releases = (await getChangelog()).filter((r) => r.note || r.sections.length > 0);

  return (
    <div className="mx-auto w-full max-w-2xl p-6 sm:p-12 space-y-8">
      <PageHeader crumbs={[{ label: "changelog" }]} />
      <div className="space-y-10">
        {releases.map((release) => (
          <section key={release.version} className="space-y-4">
            <div className="flex items-baseline gap-3">
              <h2 className="text-heading">{release.version}</h2>
              {release.date ? <span className="text-caption">{release.date}</span> : null}
            </div>
            {release.note ? (
              <p className="text-muted-foreground">{renderInline(release.note)}</p>
            ) : null}
            {release.sections.map((section) => (
              <div key={section.title} className="space-y-2">
                <h3 className="text-label">{section.title}</h3>
                <ul className="list-disc space-y-1 pl-5">
                  {section.items.map((item) => (
                    <li key={item}>{renderInline(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
