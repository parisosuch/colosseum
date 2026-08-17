// Renders markdown that has *already* been converted to sanitized HTML, styled
// by the `.doc` rules in globals.css. It holds no parser and no sanitizer, so
// it costs a client bundle nothing — which is the point: block cards get their
// HTML from the server (`Column.html`, produced by toColumn) instead of parsing
// markdown in the browser.
//
// The only two producers of `html` are renderMarkdown's output and the `html`
// field toColumn fills from it, both of which run sanitize-html on the server.
// Nothing here accepts HTML that came from a client.
export function RenderedMarkdown({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className ? `doc ${className}` : "doc"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
