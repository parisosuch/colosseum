import { expect, test } from "bun:test";

import { instagramRef, isInstagramUrl } from "@/lib/utils";

test("instagramRef reads a post from every form that names one", () => {
  // The bare form, the canonical form Instagram redirects to, reels, IGTV, and
  // the share-sheet link the app hands out — all the same post.
  for (const url of [
    "https://www.instagram.com/p/DbbY9pdm6Q2/",
    "https://instagram.com/p/DbbY9pdm6Q2",
    "instagram.com/p/DbbY9pdm6Q2/?igsh=abc123",
    "https://www.instagram.com/share/p/DbbY9pdm6Q2/",
  ]) {
    expect(instagramRef(url)).toMatchObject({ kind: "post", shortcode: "DbbY9pdm6Q2" });
  }

  expect(instagramRef("https://www.instagram.com/instagram/reel/DcOkE0Myfhh/")).toEqual({
    kind: "post",
    shortcode: "DcOkE0Myfhh",
    username: "instagram",
    url: "https://www.instagram.com/instagram/reel/DcOkE0Myfhh/",
  });
  expect(instagramRef("https://www.instagram.com/reels/DcOkE0Myfhh/")?.url).toBe(
    "https://www.instagram.com/reels/DcOkE0Myfhh/",
  );
  expect(instagramRef("https://www.instagram.com/tv/DcOkE0Myfhh/")).toMatchObject({ kind: "post" });
});

test("instagramRef reads an account, whichever profile tab was copied", () => {
  const account = { kind: "account", username: "instagram" };
  for (const url of [
    "https://www.instagram.com/instagram/",
    "https://m.instagram.com/instagram",
    "instagram.com/instagram/reels/",
    "https://www.instagram.com/instagram/tagged/",
  ]) {
    expect(instagramRef(url)).toMatchObject(account);
  }

  // Whatever form it arrived in, the block links to the profile root.
  expect(instagramRef("https://www.instagram.com/instagram/tagged/")?.url).toBe(
    "https://www.instagram.com/instagram/",
  );
  // Dots and underscores are legal in a username; hyphens aren't.
  expect(instagramRef("https://www.instagram.com/some.user_name/")).toMatchObject({
    kind: "account",
    username: "some.user_name",
  });
});

test("instagramRef rejects the instagram.com pages that aren't a post or a profile", () => {
  // Stories expire, so a card built from one would go dead; the rest are
  // Instagram's own pages, which look like a username but aren't one.
  expect(instagramRef("https://www.instagram.com/stories/instagram/123456/")).toBeNull();
  expect(instagramRef("https://www.instagram.com/explore/tags/food/")).toBeNull();
  expect(instagramRef("https://www.instagram.com/accounts/login/")).toBeNull();
  expect(instagramRef("https://www.instagram.com/direct/inbox/")).toBeNull();
  // Case-insensitively, since the path is.
  expect(instagramRef("https://www.instagram.com/Explore/")).toBeNull();

  expect(instagramRef("https://www.instagram.com/")).toBeNull();
  expect(instagramRef("https://www.instagram.com/p/")).toBeNull();
  expect(instagramRef("https://example.com/instagram")).toBeNull();
  expect(instagramRef("not a url")).toBeNull();
});

test("isInstagramUrl tracks instagramRef", () => {
  expect(isInstagramUrl("https://www.instagram.com/p/DbbY9pdm6Q2/")).toBe(true);
  expect(isInstagramUrl("https://www.instagram.com/instagram/")).toBe(true);
  expect(isInstagramUrl("https://www.instagram.com/accounts/login/")).toBe(false);
  expect(isInstagramUrl("https://example.com")).toBe(false);
});
