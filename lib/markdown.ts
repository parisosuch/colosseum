import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Render user-supplied markdown to sanitized HTML. marked builds the HTML;
// sanitize-html then strips anything unsafe (scripts, event handlers,
// javascript: URLs) — this is user input, unlike the trusted checked-in docs
// the developers page renders unsanitized. sanitize-html is pure JS (no DOM /
// jsdom), so it bundles for `next build` where isomorphic-dompurify did not.
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "strong",
      "em",
      "del",
      "hr",
      "br",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
      code: ["class"],
    },
    // Default allowedSchemes (http, https, ftp, mailto) drop javascript: URLs.
  });
}
