import { expect, test } from "bun:test";

import { parseYouTubeChannelMeta } from "./youtube-channel";

// Trimmed to the tags the parser reads, in the shape YouTube serves them.
const CHANNEL_PAGE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Syntax">
<meta property="og:site_name" content="YouTube">
<meta property="og:url" content="https://www.youtube.com/channel/UCyU5wkjgQYGRB0hIHMwm2Sg">
<meta property="og:image" content="https://yt3.googleusercontent.com/gvvHQOWCRiNehiIKqDNS59Dapv=s900-c-k-c0x00ffffff-no-rj">
<meta name="description" content="Hosted by Wes Bos and Scott Tolinski since 2017.">
<title>Syntax - YouTube</title>
</head><body><script>var ytcfg = {"vanityChannelUrl":"http://www.youtube.com/@syntaxfm"};</script></body></html>`;

test("parseYouTubeChannelMeta pulls the name, blurb, and avatar", () => {
  const meta = parseYouTubeChannelMeta(
    CHANNEL_PAGE,
    "https://www.youtube.com/channel/UCyU5wkjgQYGRB0hIHMwm2Sg",
  );
  expect(meta.title).toBe("Syntax");
  expect(meta.description).toBe("Hosted by Wes Bos and Scott Tolinski since 2017.");
  expect(meta.avatarUrl).toBe(
    "https://yt3.googleusercontent.com/gvvHQOWCRiNehiIKqDNS59Dapv=s900-c-k-c0x00ffffff-no-rj",
  );
});

test("parseYouTubeChannelMeta prefers the @handle URL over the one fetched", () => {
  // Added from /channel/UC…, but the block should link to the readable form.
  const meta = parseYouTubeChannelMeta(
    CHANNEL_PAGE,
    "https://www.youtube.com/channel/UCyU5wkjgQYGRB0hIHMwm2Sg",
  );
  expect(meta.url).toBe("https://www.youtube.com/@syntaxfm");
});

test("parseYouTubeChannelMeta falls back to the fetched URL when there's no handle", () => {
  const html = `<meta property="og:title" content="Some Channel">`;
  const meta = parseYouTubeChannelMeta(html, "https://www.youtube.com/c/SomeChannel");
  expect(meta.url).toBe("https://www.youtube.com/c/SomeChannel");
  expect(meta.avatarUrl).toBeNull();
});
