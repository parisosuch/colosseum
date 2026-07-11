import { expect, test } from "bun:test";

import { renderMarkdown } from "./markdown";

test("renders basic markdown to HTML", () => {
  const html = renderMarkdown("# Title\n\n**bold** and _italic_\n\n- one\n- two");
  expect(html).toContain("<h1>Title</h1>");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>italic</em>");
  expect(html).toContain("<li>one</li>");
});

test("strips a script tag", () => {
  const html = renderMarkdown("hello <script>alert('xss')</script> world");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("alert(");
});

test("strips inline event handlers", () => {
  const html = renderMarkdown('<img src="x" onerror="alert(1)">');
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("alert(1)");
});

test("neutralizes javascript: links", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  expect(html).not.toContain("javascript:");
});
