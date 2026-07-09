import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { marked } from "marked";

import PageHeader from "@/components/page-header";

export const metadata: Metadata = {
  title: "Developers — Colosseum",
  description: "REST API and MCP server reference for Colosseum.",
};

type TocEntry = { depth: number; text: string; id: string };

function slugify(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// The developer docs are the repo's own `docs/*.md` — one source of truth,
// rendered here and viewable on GitHub. marked's output is trusted (our own
// checked-in files, not user input), so it's safe to inject directly. `prefix`
// namespaces heading ids per doc so a section shared across docs (e.g.
// "Authentication") gets a unique anchor.
async function loadDoc(file: string, prefix: string): Promise<{ html: string; toc: TocEntry[] }> {
  const md = await readFile(path.join(process.cwd(), "docs", file), "utf8");

  const toc: TocEntry[] = [];
  for (const t of marked.lexer(md)) {
    if (t.type === "heading" && t.depth <= 2) {
      toc.push({ depth: t.depth, text: t.text, id: `${prefix}-${slugify(t.text)}` });
    }
  }

  const html = marked
    .parse(md, { async: false })
    .replace(
      /<(h[12])>(.*?)<\/\1>/g,
      (_m, tag, inner) => `<${tag} id="${prefix}-${slugify(inner)}">${inner}</${tag}>`,
    );

  return { html, toc };
}

export default async function DevelopersPage() {
  const docs = await Promise.all([loadDoc("api.md", "api"), loadDoc("mcp.md", "mcp")]);

  // Same TOC in both layouts: a collapsed disclosure above the docs on mobile,
  // a sticky sidebar on desktop.
  const tocList = docs.map((doc, i) => (
    <div key={i} className="space-y-1">
      {doc.toc.map((entry) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          className={
            entry.depth === 1
              ? "block font-medium text-foreground hover:underline"
              : "block pl-3 text-muted-foreground hover:text-foreground"
          }
        >
          {entry.text}
        </a>
      ))}
    </div>
  ));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 sm:px-12">
      <div className="sticky top-0 z-10 -mx-6 bg-background px-6 py-6 sm:-mx-12 sm:px-12">
        <PageHeader crumbs={[{ label: "developers" }]} />
      </div>
      <details className="mb-6 rounded-md border p-4 text-sm lg:hidden">
        <summary className="cursor-pointer font-medium">On this page</summary>
        <div className="mt-4 space-y-5">{tocList}</div>
      </details>
      <div className="flex gap-10 pb-6 sm:pb-12">
        <nav className="sticky top-24 hidden h-fit w-52 shrink-0 space-y-5 text-sm lg:block">
          {tocList}
        </nav>
        <div className="min-w-0 flex-1 space-y-8">
          <article className="doc" dangerouslySetInnerHTML={{ __html: docs[0].html }} />
          <hr className="border-border" />
          <article className="doc" dangerouslySetInnerHTML={{ __html: docs[1].html }} />
        </div>
      </div>
    </div>
  );
}
