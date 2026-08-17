import "server-only";

import { renderMarkdown } from "@/lib/markdown";
import { RenderedMarkdown } from "./rendered-markdown";

// Markdown source → rendered HTML, for server components that hold the source
// rather than a block's pre-rendered `html` (the permalink page, the preview
// cards on the profile and explore feeds).
//
// The `server-only` import is load-bearing, not decoration. This module pulls in
// marked and sanitize-html; importing it from a client component would put both
// back into every viewer's bundle, which is exactly what this indirection
// exists to prevent. The build fails instead. Client code renders
// `RenderedMarkdown` with server-produced HTML, or (for a live draft)
// `markdown-preview`, which is loaded on demand.
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <RenderedMarkdown html={renderMarkdown(text)} className={className} />;
}
