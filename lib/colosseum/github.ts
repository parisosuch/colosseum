// Metadata for a GitHub block: a repo's or account's name, description, avatar,
// and (for a repo) its primary language.
//
// A screenshot of github.com is mostly chrome — nav bars, sidebars, a cookie
// banner — so a GitHub link makes a far better card composed from the REST API
// than captured as a picture. The data comes from the public API, which needs
// no credentials.
//
// Nothing volatile is captured. Stars, forks, and open-issue counts are all
// available here and all deliberately unused: metadata is fetched once when the
// block is created and never refreshed, so a count would freeze at whatever it
// was that day and quietly rot. Names, descriptions, and languages drift slowly
// enough to be worth storing.
//
// Deliberately free of DB / server-only imports so the parser stays
// unit-testable, like og-meta.ts.

import { logError } from "@/lib/log";

export type GitHubMeta = {
  // "owner/repo" for a repo; the account's display name (or login) otherwise.
  title: string;
  // Repo description or account bio. Empty when the account/repo has none.
  description: string;
  // The owner's avatar, or null when the API didn't return one.
  avatarUrl: string | null;
  // The repo's primary language, or null for accounts and for repos GitHub
  // hasn't classified (an empty repo, or one that is all config).
  language: string | null;
  // Canonical github.com URL, as GitHub spells it — so a block added from a
  // deep link or a differently-cased owner still links to the real page.
  url: string;
};

// GitHub allows unauthenticated reads at 60/hour/IP, which is plenty for
// occasional block creation but not for a busy instance. A token raises it to
// 5000/hour. Optional on purpose: colosseum has to run with nothing configured,
// so a missing token costs rate limit, never functionality.
function apiHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects API requests without one.
    "User-Agent": "colosseum",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

type RepoResponse = {
  full_name?: string;
  description?: string | null;
  language?: string | null;
  html_url?: string;
  owner?: { avatar_url?: string };
};

type UserResponse = {
  login?: string;
  name?: string | null;
  bio?: string | null;
  html_url?: string;
  avatar_url?: string;
};

// Fetch metadata for a repo or an account. Returns null when GitHub says the
// thing doesn't exist (404), when the rate limit is exhausted (403/429), or on
// any network failure — every one of which the caller turns into a plain URL
// block, so a GitHub link always lands as *something*.
export async function fetchGitHubMeta(
  ref: { kind: "repo"; owner: string; repo: string } | { kind: "account"; owner: string },
): Promise<GitHubMeta | null> {
  const path =
    ref.kind === "repo"
      ? `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
      : `users/${encodeURIComponent(ref.owner)}`;

  try {
    const res = await fetch(`https://api.github.com/${path}`, { headers: apiHeaders() });
    if (!res.ok) {
      // 403/429 is the rate limit, which is worth distinguishing in the log:
      // a burst of these means the instance wants a GITHUB_TOKEN.
      if (res.status === 403 || res.status === 429) {
        logError("github.api", `rate limited fetching ${path}`, new Error(`HTTP ${res.status}`));
      }
      return null;
    }
    const data = (await res.json()) as RepoResponse & UserResponse;

    if (ref.kind === "repo") {
      const title = data.full_name || `${ref.owner}/${ref.repo}`;
      return {
        title,
        description: data.description ?? "",
        avatarUrl: data.owner?.avatar_url ?? null,
        language: data.language ?? null,
        url: data.html_url || `https://github.com/${ref.owner}/${ref.repo}`,
      };
    }

    return {
      // An account without a display name shows its login, which is what
      // GitHub's own profile header does.
      title: data.name || data.login || ref.owner,
      description: data.bio ?? "",
      avatarUrl: data.avatar_url ?? null,
      language: null,
      url: data.html_url || `https://github.com/${ref.owner}`,
    };
  } catch (e) {
    logError("github.api", `metadata lookup failed for ${path}`, e);
    return null;
  }
}
