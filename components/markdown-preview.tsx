"use client";

import { renderMarkdown } from "@/lib/markdown";
import { RenderedMarkdown } from "./rendered-markdown";

// Renders an unsaved markdown draft in the browser — the block modal's Preview
// tab, where there is no saved block to render yet. This is the one place the
// parser and sanitizer still ship to a client, so it's never imported
// statically: block-modal pulls it through next/dynamic when an editor actually
// types, keeping it out of the grid's bundle.
//
// It runs the same renderMarkdown as the server, so a draft is sanitized by the
// identical allowlist before it reaches dangerouslySetInnerHTML. Nothing it
// produces is persisted or shown to another viewer; the saved copy is rendered
// server-side on the way back out.
export default function MarkdownPreview({ text, className }: { text: string; className?: string }) {
  return <RenderedMarkdown html={renderMarkdown(text)} className={className} />;
}
