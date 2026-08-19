import { expect, test } from "bun:test";

import { githubRef, isGitHubUrl } from "@/lib/utils";

test("githubRef reads a repo, and normalizes the forms that point at one", () => {
  const repo = { kind: "repo", owner: "anthropics", repo: "claude-code" };

  // The plain form, and the ones people actually copy: a deep link into a file,
  // a release, and a clone URL all name the same repo.
  for (const url of [
    "https://github.com/anthropics/claude-code",
    "https://github.com/anthropics/claude-code/blob/main/README.md",
    "https://github.com/anthropics/claude-code/releases/tag/v1.0.0",
    "https://github.com/anthropics/claude-code.git",
    "https://www.github.com/anthropics/claude-code",
    "github.com/anthropics/claude-code",
  ]) {
    expect(githubRef(url)).toMatchObject(repo);
  }

  // Whatever form it arrived in, the block links to the canonical page.
  expect(githubRef("https://github.com/anthropics/claude-code/blob/main/README.md")?.url).toBe(
    "https://github.com/anthropics/claude-code",
  );
});

test("githubRef reads an account", () => {
  expect(githubRef("https://github.com/torvalds")).toEqual({
    kind: "account",
    owner: "torvalds",
    url: "https://github.com/torvalds",
  });
});

test("githubRef rejects non-repo github.com pages and other hosts", () => {
  // Reserved paths look like an account but aren't one; they should stay plain
  // URL blocks rather than become a card for a profile that doesn't exist.
  expect(githubRef("https://github.com/features")).toBeNull();
  expect(githubRef("https://github.com/pricing")).toBeNull();
  expect(githubRef("https://github.com/explore")).toBeNull();
  // Case-insensitively, since the path is.
  expect(githubRef("https://github.com/Features")).toBeNull();

  expect(githubRef("https://github.com/")).toBeNull();
  expect(githubRef("https://gitlab.com/foo/bar")).toBeNull();
  expect(githubRef("https://gist.github.com/foo/abc123")).toBeNull();
  expect(githubRef("not a url")).toBeNull();
});

test("isGitHubUrl tracks githubRef", () => {
  expect(isGitHubUrl("https://github.com/anthropics/claude-code")).toBe(true);
  expect(isGitHubUrl("https://github.com/torvalds")).toBe(true);
  expect(isGitHubUrl("https://github.com/pricing")).toBe(false);
  expect(isGitHubUrl("https://example.com")).toBe(false);
});
