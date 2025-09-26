import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

export function isURL(text: string): boolean {
  try {
    // If the text has no scheme, prepend http://
    const url = new URL(
      /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text) ? text : `http://${text}`
    );

    // Optionally, require at least a hostname and a TLD
    return Boolean(url.hostname && url.hostname.includes("."));
  } catch {
    return false;
  }
}
