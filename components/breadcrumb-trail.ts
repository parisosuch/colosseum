// One step of a breadcrumb: a label, and where it leads when it's a parent
// that can be visited.
export type Crumb = { label: string; href?: string };

// What a parent crumb renders as: a link, or plain text when there's nowhere
// to go (a share link made for one block has no board to step back to).
export type TrailParent = { label: string; href: string | null };

// Splits a page's crumbs into the trail of parents and the page itself. The
// last crumb is always the current page, so it never becomes a link even when
// a caller passes it an href.
export function splitTrail(crumbs: readonly Crumb[]): {
  parents: TrailParent[];
  current: string | null;
} {
  if (crumbs.length === 0) return { parents: [], current: null };
  const parents = crumbs.slice(0, -1).map((c) => ({ label: c.label, href: c.href ?? null }));
  return { parents, current: crumbs[crumbs.length - 1].label };
}
