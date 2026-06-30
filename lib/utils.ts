import { clsx, type ClassValue } from "clsx";
import { TLDs } from "global-tld-list";
import { twMerge } from "tailwind-merge";
import { parse } from "tldts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isURL(text: string): boolean {
  let url: URL;
  try {
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text) ? text : `http://${text}`;
    url = new URL(candidate);
  } catch {
    return false;
  }

  const hostname = url.hostname; // e.g. "foo.example.com"

  // Use tldts to parse the hostname / URL
  const info = parse(hostname, { allowPrivateDomains: false });

  if (info.isIp) {
    return false;
  }

  // If there is no public suffix or domain part, it’s invalid
  if (!info.publicSuffix || !info.domain) {
    return false;
  }

  // Check that the TLD (suffix) is in the global TLD list
  const tld = info.publicSuffix.toLowerCase();
  if (!TLDs.isValid(tld)) {
    return false;
  }

  return true;
}

// Parses a comma-separated tags input into a deduped, trimmed list.
export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

export function timeAgo(date: Date) {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  const intervals: { [key: string]: number } = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, value] of Object.entries(intervals)) {
    const amount = Math.floor(seconds / value);
    if (amount >= 1) {
      return `${amount} ${unit}${amount > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}
