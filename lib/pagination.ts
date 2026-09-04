// Blocks fetched per page on the channel board — used by the server component
// that renders the first page and the client board that pages the rest. Lives
// in a neutral (non-"use client", non-server-only) module because a value
// exported from a "use client" file reaches a Server Component as a client
// reference, not the number, which silently disables the query's limit.
export const PAGE_SIZE = 50;

// Placeholder tiles shown while a channel's first page loads — a few rows' worth
// at the widest grid. The board and the route's `loading.tsx` both render this
// many, so the instant shell and the hydrating board reserve the same space.
// Here rather than in the board for the same reason as PAGE_SIZE: `loading.tsx`
// is a Server Component and would receive a client reference, not the number.
export const SKELETON_COUNT = 18;
