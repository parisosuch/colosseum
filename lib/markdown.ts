import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

// Render user-supplied markdown to sanitized HTML. marked builds the HTML;
// DOMPurify then strips anything unsafe (scripts, event handlers, javascript:
// URLs) — this is user input, unlike the trusted checked-in docs the developers
// page renders unsanitized. Sync parse so it works in a render pass.
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}
