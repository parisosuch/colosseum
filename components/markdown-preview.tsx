"use client";

import { useEffect, useState } from "react";

import { renderMarkdownDraftAction } from "@/lib/colosseum/actions";
import { RenderedMarkdown } from "./rendered-markdown";

// How long the draft has to sit still before it's worth a round trip.
const DEBOUNCE_MS = 250;

// Renders an unsaved markdown draft in the block modal's Preview tab, where
// there is no saved block to render yet.
//
// The render happens on the server. The parser is Bun.markdown (a bun global,
// absent in a browser) and the sanitizer is sanitize-html, so keeping this
// client-side would mean a second renderer with different output — the one
// thing this must not do, since the draft has to be sanitized by the identical
// allowlist the saved copy goes through.
//
// Typing is debounced so a burst of keystrokes costs one call, and out-of-order
// responses are dropped: only the reply for the text currently on screen wins.
export default function MarkdownPreview({ text, className }: { text: string; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      renderMarkdownDraftAction(text)
        .then((h) => live && setHtml(h))
        .catch(() => live && setHtml(null));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [text]);

  if (html === null) {
    return <p className="text-sm text-muted-foreground">Rendering preview…</p>;
  }
  return <RenderedMarkdown html={html} className={className} />;
}
