import { beforeEach, expect, test } from "bun:test";

import {
  MARKDOWN_CACHE_MAX_CHARS,
  MARKDOWN_CACHE_MAX_ENTRIES,
  markdownCacheStats,
  renderMarkdown,
  resetMarkdownCache,
} from "./markdown";

beforeEach(() => {
  resetMarkdownCache();
});

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

test("renders the same source once and serves the repeat from the memo", () => {
  const md = "## Repeated\n\nthe same block, fetched twice";
  const first = renderMarkdown(md);
  expect(markdownCacheStats()).toMatchObject({ entries: 1, hits: 0, misses: 1 });

  expect(renderMarkdown(md)).toBe(first);
  expect(markdownCacheStats()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
});

test("keys on the source, so an edited block renders fresh HTML", () => {
  expect(renderMarkdown("before")).toContain("<p>before</p>");
  expect(renderMarkdown("after")).toContain("<p>after</p>");
  expect(markdownCacheStats()).toMatchObject({ entries: 2, hits: 0, misses: 2 });
});

test("a memoized render is still sanitized on the way back out", () => {
  const md = "hi <script>alert('xss')</script>";
  expect(renderMarkdown(md)).toBe(renderMarkdown(md));
  expect(renderMarkdown(md)).not.toContain("<script");
  expect(markdownCacheStats().hits).toBe(2);
});

test("evicts the least recently used entry once the entry cap is reached", () => {
  for (let i = 0; i < MARKDOWN_CACHE_MAX_ENTRIES; i++) renderMarkdown(`note ${i}`);
  expect(markdownCacheStats().entries).toBe(MARKDOWN_CACHE_MAX_ENTRIES);

  // Touch the oldest entry to make it the newest, then overflow by one. The
  // entry that goes is the one behind it, not the one just used.
  renderMarkdown("note 0");
  renderMarkdown("one more");
  expect(markdownCacheStats().entries).toBe(MARKDOWN_CACHE_MAX_ENTRIES);

  const before = markdownCacheStats();
  renderMarkdown("note 0");
  expect(markdownCacheStats().hits).toBe(before.hits + 1);
  renderMarkdown("note 1");
  expect(markdownCacheStats().misses).toBe(before.misses + 1);
});

test("stays inside the character budget when the blocks are long", () => {
  // Blocks far below the entry cap in number but big enough to overrun the
  // character budget, which is the case the entry count alone doesn't cover.
  const long = "lorem ipsum dolor sit amet ".repeat(11_000);
  for (let i = 0; i < 5; i++) renderMarkdown(`block ${i} ${long}`);

  const { chars, entries } = markdownCacheStats();
  expect(chars).toBeLessThanOrEqual(MARKDOWN_CACHE_MAX_CHARS);
  expect(entries).toBeGreaterThan(0);
  expect(entries).toBeLessThan(5);
});

test("skips caching a block too big to fit the budget at all", () => {
  const huge = "x".repeat(MARKDOWN_CACHE_MAX_CHARS + 1);
  expect(renderMarkdown(huge)).toContain("<p>");
  expect(markdownCacheStats()).toMatchObject({ entries: 0, chars: 0 });
});
