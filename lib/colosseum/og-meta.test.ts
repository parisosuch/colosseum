import { expect, test } from "bun:test";

import { parseOgMeta } from "./og-meta";

test("prefers og:image and resolves a relative URL against the base", () => {
  const html = `
    <head>
      <meta property="og:image" content="/thumb.png" />
      <meta property="og:title" content="Hello &amp; Co" />
      <meta property="og:description" content="A description." />
    </head>`;
  const meta = parseOgMeta(html, "https://example.com/page");
  expect(meta.imageUrl).toBe("https://example.com/thumb.png");
  expect(meta.title).toBe("Hello & Co");
  expect(meta.description).toBe("A description.");
});

test("handles reversed attribute order and single quotes", () => {
  const html = `<meta content='https://cdn.example.com/x.jpg' property='og:image'>`;
  expect(parseOgMeta(html, "https://example.com").imageUrl).toBe("https://cdn.example.com/x.jpg");
});

test("falls back to twitter:image, <title>, and meta description", () => {
  const html = `
    <title>Doc Title</title>
    <meta name="twitter:image" content="https://example.com/tw.png">
    <meta name="description" content="Meta desc.">`;
  const meta = parseOgMeta(html, "https://example.com");
  expect(meta.imageUrl).toBe("https://example.com/tw.png");
  expect(meta.title).toBe("Doc Title");
  expect(meta.description).toBe("Meta desc.");
});

test("returns null image when there's no preview and doesn't invent one", () => {
  const meta = parseOgMeta(`<title>Just a title</title>`, "https://example.com");
  expect(meta.imageUrl).toBeNull();
  expect(meta.title).toBe("Just a title");
  expect(meta.description).toBe("");
});
