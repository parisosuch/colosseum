import { expect, test } from "bun:test";

import { parseInstagramMeta } from "./instagram";

// Trimmed to the tags the parser reads, in the shape Instagram serves them to a
// link-preview crawler — numeric entities and all (it writes every @ as &#064;
// and every emoji as a hex entity).
const REEL_PAGE = `<!DOCTYPE html><html><head>
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Instagram" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.1/778236496.jpg?_nc_cat=1&amp;oe=6A8FA261" />
<meta property="og:url" content="https://www.instagram.com/instagram/reel/DcOkE0Myfhh/" />
<meta property="og:title" content="Instagram on Instagram: &quot;&#064;kazaneat does football tricks &#x1f525;

Video by &#064;kazaneat&quot;" />
<meta property="og:description" content="418K likes, 14K comments - instagram on August 19, 2026: &quot;&#064;kazaneat does football tricks &#x1f525;&quot;" />
<title>Instagram</title>
</head></html>`;

// An account page: the bio is quoted inside the plain description, while
// og:description carries the follower counts.
const PROFILE_PAGE = `<!DOCTYPE html><html><head>
<meta property="og:type" content="profile" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.2/550891366.jpg" />
<meta property="og:title" content="Instagram (&#064;instagram) &#x2022; Instagram photos and videos" />
<meta property="og:url" content="https://www.instagram.com/instagram/" />
<meta property="og:description" content="686M Followers, 276 Following, 8,562 Posts - See Instagram photos and videos from Instagram (&#064;instagram)" />
<meta content="686M Followers, 276 Following, 8,562 Posts - Instagram (&#064;instagram) on Instagram: &quot;Discover what&#039;s new on Instagram &#x1f50e;&quot;" name="description" />
<title>Instagram</title>
</head></html>`;

test("parseInstagramMeta reads a post's picture, caption, and author", () => {
  const meta = parseInstagramMeta(REEL_PAGE, "https://www.instagram.com/reel/DcOkE0Myfhh/");
  expect(meta).not.toBeNull();
  expect(meta?.kind).toBe("post");
  // The handle is the block's title — the picture is its subject.
  expect(meta?.title).toBe("@instagram");
  // The caption, with its entities decoded and its line breaks kept, and
  // without the like/comment counts og:description would have prefixed.
  expect(meta?.description).toBe("@kazaneat does football tricks 🔥\n\nVideo by @kazaneat");
  expect(meta?.imageUrl).toBe(
    "https://scontent.cdninstagram.com/v/t51.1/778236496.jpg?_nc_cat=1&oe=6A8FA261",
  );
  // Added from the username-less URL, but the block links to the canonical one.
  expect(meta?.url).toBe("https://www.instagram.com/instagram/reel/DcOkE0Myfhh/");
});

test("parseInstagramMeta reads an account's name, bio, and avatar", () => {
  const meta = parseInstagramMeta(PROFILE_PAGE, "https://www.instagram.com/instagram/");
  expect(meta?.kind).toBe("account");
  expect(meta?.title).toBe("Instagram");
  // The bio, not the follower counts — those would freeze on the day the block
  // was added.
  expect(meta?.description).toBe("Discover what's new on Instagram 🔎");
  expect(meta?.imageUrl).toBe("https://scontent.cdninstagram.com/v/t51.2/550891366.jpg");
  expect(meta?.url).toBe("https://www.instagram.com/instagram/");
});

test("parseInstagramMeta gives up on the login wall", () => {
  // What an ordinary browser fetch gets back: a shell with no metadata in it.
  expect(parseInstagramMeta(`<html><head><title>Instagram</title></head></html>`, "x")).toBeNull();
});

test("parseInstagramMeta survives a post with no caption", () => {
  const html = `<meta property="og:type" content="article" />
<meta property="og:url" content="https://www.instagram.com/someone/p/Abcde12345/" />
<meta property="og:image" content="https://scontent.cdninstagram.com/x.jpg" />`;
  const meta = parseInstagramMeta(html, "https://www.instagram.com/p/Abcde12345/");
  expect(meta?.title).toBe("@someone");
  expect(meta?.description).toBe("");
});
