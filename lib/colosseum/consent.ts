import type { CookieData } from "puppeteer";

// Cookies that pre-answer a site's consent interstitial, so a capture renders
// the page itself instead of the wall.
//
// Google shows that wall to any visitor it can't tie to an earlier choice, and a
// capture from a datacenter IP is always one of those — so a YouTube channel
// screenshots as "Before you continue to YouTube". `SOCS=CAI` is what Google
// stores when the notice has been shown and nothing beyond the essentials was
// accepted: it dismisses the wall without opting into personalization or ad
// tracking, which is the right choice to make on someone else's behalf.
//
// Keyed by the registrable domain the cookie belongs to; matched against the
// URL's hostname, so `www.youtube.com` and `m.youtube.com` both hit `.youtube.com`.
const CONSENT_COOKIES: Record<string, { name: string; value: string }[]> = {
  "youtube.com": [{ name: "SOCS", value: "CAI" }],
  "google.com": [{ name: "SOCS", value: "CAI" }],
};

// The consent cookies to set before capturing `url`, or [] when the site isn't
// one we know a wall for. Pure — the caller hands these to the browser.
export function consentCookies(url: string): CookieData[] {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  const domain = Object.keys(CONSENT_COOKIES).find((d) => host === d || host.endsWith(`.${d}`));
  if (!domain) return [];
  return CONSENT_COOKIES[domain].map((c) => ({
    ...c,
    domain: `.${domain}`,
    path: "/",
  }));
}
