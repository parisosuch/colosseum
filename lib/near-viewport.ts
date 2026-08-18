// Tracks which block cards are close enough to the viewport to be worth
// rendering their media, so a channel scrolled ten pages deep isn't holding a
// decoded thumbnail (and, for tweet blocks, a whole embed) for every card ever
// loaded. One IntersectionObserver watches every card rather than one per card:
// a 600-block channel would otherwise allocate 600 observers to answer the same
// question about the same root.
//
// The observer is created on the first watch and disconnected when the last
// element unwatches, so a control change that swaps the whole grid out doesn't
// leave one behind holding references to detached nodes.
//
// React-free, with the observer constructor passed in, so it unit-tests as a
// plain module — the same split as lib/prefetch.ts and lib/comment-cache.ts.
// The hook that binds it to a card lives in components/near-viewport.ts.

// How far outside the viewport a card still counts as near. Four grid rows at
// the widest breakpoint, which is roughly a second of unhurried scrolling —
// enough lead that media is back before the card is, without keeping so much
// mounted that the bound stops meaning anything. Deliberately wider than the
// 600px the load-more sentinel uses: missing a page load costs a spinner,
// missing a thumbnail costs a blank card the viewer is already looking at.
export const NEAR_VIEWPORT_MARGIN_PX = 1200;

// The slice of IntersectionObserver this needs. Entries are narrowed to the two
// fields the dispatch reads, so a test can hand over a plain object.
export type NearViewportEntry = { target: Element; isIntersecting: boolean };

export type NearViewportObserver = {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
};

export type NearViewportObserverFactory = (
  callback: (entries: NearViewportEntry[]) => void,
  options: { rootMargin: string },
) => NearViewportObserver;

export type NearViewportWatch = {
  // Start reporting whether `target` is near. `onChange` fires only when the
  // answer changes, starting from `startsNear`. Returns the unwatch, so an
  // effect can hand it straight back as its cleanup.
  watch(target: Element, startsNear: boolean, onChange: (near: boolean) => void): () => void;
  // Elements currently watched. Exposed for tests asserting the observer is
  // released once the last card goes.
  size(): number;
};

export function createNearViewport(
  factory: NearViewportObserverFactory,
  marginPx: number = NEAR_VIEWPORT_MARGIN_PX,
): NearViewportWatch {
  type Entry = { near: boolean; onChange: (near: boolean) => void };
  const watched = new Map<Element, Entry>();
  let observer: NearViewportObserver | null = null;

  const dispatch = (entries: NearViewportEntry[]) => {
    for (const entry of entries) {
      const watcher = watched.get(entry.target);
      // An element unwatched between the observation and this callback still
      // arrives in the batch; it has nothing left to tell.
      if (!watcher || watcher.near === entry.isIntersecting) continue;
      watcher.near = entry.isIntersecting;
      watcher.onChange(entry.isIntersecting);
    }
  };

  return {
    watch(target, startsNear, onChange) {
      watched.set(target, { near: startsNear, onChange });
      observer ??= factory(dispatch, { rootMargin: `${marginPx}px 0px` });
      observer.observe(target);

      return () => {
        if (!watched.delete(target)) return;
        observer?.unobserve(target);
        if (watched.size === 0) {
          observer?.disconnect();
          observer = null;
        }
      };
    },
    size: () => watched.size,
  };
}
