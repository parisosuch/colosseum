import { expect, test } from "bun:test";

import { consentCookies } from "./consent";

test("consentCookies answers YouTube's wall on every subdomain", () => {
  for (const url of [
    "https://www.youtube.com/@syntaxfm/videos",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/@syntaxfm",
  ]) {
    expect(consentCookies(url)).toEqual([
      { name: "SOCS", value: "CAI", domain: ".youtube.com", path: "/" },
    ]);
  }
});

test("consentCookies leaves other sites alone", () => {
  expect(consentCookies("https://example.com/page")).toEqual([]);
  // Suffix match is on the domain boundary, not the bare string.
  expect(consentCookies("https://notyoutube.com/")).toEqual([]);
  expect(consentCookies("https://youtube.com.evil.test/")).toEqual([]);
  expect(consentCookies("not a url")).toEqual([]);
});
