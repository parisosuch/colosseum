import { renderMarkdown } from "@/lib/markdown";

// Shared renderer, styled by the `.doc` rules in globals.css. No "use client":
// it's a pure function of its props, so it composes into both server and client
// components (the block card, the modal preview, the permalink page).
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className ? `doc ${className}` : "doc"}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
