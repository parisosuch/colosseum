"use client";

import { createContext, useContext, type ReactNode } from "react";

// A share-link page (/s/<token>): the token rides along on the reads its
// components make for the link holder (board paging, the modal's arrows,
// comments, export), and `base` is where the link lives, so URLs the page
// writes — the modal's `?block=`, a permalink — stay inside it.
export type ShareScope = { token: string; base: string };

const ShareContext = createContext<ShareScope | null>(null);

export function ShareProvider({ share, children }: { share: ShareScope; children: ReactNode }) {
  return <ShareContext.Provider value={share}>{children}</ShareContext.Provider>;
}

// The share this component is rendering under, or null on an ordinary page.
export function useShare(): ShareScope | null {
  return useContext(ShareContext);
}
