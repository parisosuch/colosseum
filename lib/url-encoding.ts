/**
 * Encode a URL into a safe string for Supabase Storage filenames.
 * Uses URL-safe base64 (no +, /, or =).
 */
export function encodeUrlToFilename(url: string): string {
  const b64 = Buffer.from(url).toString("base64");
  // Make it URL-safe
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a Supabase-safe filename back into the original URL.
 */
export function decodeFilenameToUrl(filename: string): string {
  // Convert back to standard base64
  let b64 = filename.replace(/-/g, "+").replace(/_/g, "/");
  // Pad base64 if necessary
  while (b64.length % 4) b64 += "=";
  return Buffer.from(b64, "base64").toString("utf-8");
}
