import { expect, test } from "bun:test";

import { imageSrcFromHtml } from "./utils";

test("imageSrcFromHtml pulls the absolute <img> source a browser image-copy drops", () => {
  // What Chrome/Firefox put on the clipboard for a copied GIF.
  expect(
    imageSrcFromHtml(
      '<meta charset="utf-8"><img src="https://media.giphy.com/x/giphy.gif" alt="">',
    ),
  ).toBe("https://media.giphy.com/x/giphy.gif");
  // Attribute order / single quotes shouldn't matter.
  expect(imageSrcFromHtml("<img alt='a' src='http://e.com/a.png'>")).toBe("http://e.com/a.png");
});

test("imageSrcFromHtml returns null when there's no usable absolute image URL", () => {
  expect(imageSrcFromHtml("")).toBeNull();
  expect(imageSrcFromHtml("<p>just text</p>")).toBeNull();
  // Non-http(s) srcs (data:, blob:, relative) fall back to the clipboard file.
  expect(imageSrcFromHtml('<img src="data:image/png;base64,AAAA">')).toBeNull();
  expect(imageSrcFromHtml('<img src="/local/relative.gif">')).toBeNull();
});
