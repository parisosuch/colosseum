// Blocks fetched per page on the channel board — used by the server component
// that renders the first page and the client board that pages the rest. Lives
// in a neutral (non-"use client", non-server-only) module because a value
// exported from a "use client" file reaches a Server Component as a client
// reference, not the number, which silently disables the query's limit.
export const PAGE_SIZE = 50;
