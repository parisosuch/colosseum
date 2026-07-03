// Pure handle helpers — validation and normalization only, no database access.
// Kept db-free so client components (onboarding, profile editor) can import them
// without pulling the server-only Drizzle client into their bundle.

// Handles appear in URLs (/{handle}) and must be unique, so keep them to a
// predictable shape: lowercase letters, numbers, underscores and hyphens.
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
const HANDLE_PATTERN = /^[a-z0-9_-]+$/;

// Normalize user input into a candidate handle (does not guarantee validity).
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

// Returns null when the handle is valid, otherwise a human-readable reason.
export function validateHandle(handle: string): string | null {
  if (handle.length < HANDLE_MIN_LENGTH) {
    return `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`;
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return `Handle must be at most ${HANDLE_MAX_LENGTH} characters.`;
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handle can only contain lowercase letters, numbers, hyphens, and underscores.";
  }
  return null;
}
