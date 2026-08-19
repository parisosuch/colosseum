// The site's own card image, used when a page has no picture of its own.
//
// Next serves this from `app/opengraph-image.png` and injects it into every
// route automatically — but only for routes that don't set `openGraph`
// themselves. A route that does gets no merge and, without this, would share
// with no image at all, which is worse than the branded default it replaced.
// So pages that build their own card name the fallback explicitly.
export const SITE_CARD = { url: "/opengraph-image.png", width: 1200, height: 600 } as const;
