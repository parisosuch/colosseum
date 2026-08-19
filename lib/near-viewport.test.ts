import { expect, test } from "bun:test";

import {
  NEAR_VIEWPORT_MARGIN_PX,
  type NearViewportEntry,
  createNearViewport,
} from "./near-viewport";

// A fake IntersectionObserver: records what it was constructed with, what it
// observes, and lets a test fire entries by hand. `Element` stands in for a real
// node — nothing here touches the DOM.
function fakeObservers() {
  const built: {
    rootMargin: string;
    observed: Element[];
    unobserved: Element[];
    disconnected: number;
    fire: (entries: NearViewportEntry[]) => void;
  }[] = [];

  const factory = (
    callback: (entries: NearViewportEntry[]) => void,
    options: { rootMargin: string },
  ) => {
    const record = {
      rootMargin: options.rootMargin,
      observed: [] as Element[],
      unobserved: [] as Element[],
      disconnected: 0,
      fire: callback,
    };
    built.push(record);
    return {
      observe: (target: Element) => record.observed.push(target),
      unobserve: (target: Element) => record.unobserved.push(target),
      disconnect: () => record.disconnected++,
    };
  };

  return { built, factory };
}

const node = (name: string) => ({ name }) as unknown as Element;

test("every card shares one observer", () => {
  const { built, factory } = fakeObservers();
  const watch = createNearViewport(factory);

  const a = node("a");
  const b = node("b");
  watch.watch(a, true, () => {});
  watch.watch(b, true, () => {});

  expect(built).toHaveLength(1);
  expect(built[0].observed).toEqual([a, b]);
  expect(built[0].rootMargin).toBe(`${NEAR_VIEWPORT_MARGIN_PX}px 0px`);
  expect(watch.size()).toBe(2);
});

test("a card is told only when the answer changes", () => {
  const { built, factory } = fakeObservers();
  const watch = createNearViewport(factory);

  const card = node("card");
  const seen: boolean[] = [];
  watch.watch(card, true, (near) => seen.push(near));

  // Already near: the first intersecting entry says nothing new.
  built[0].fire([{ target: card, isIntersecting: true }]);
  expect(seen).toEqual([]);

  built[0].fire([{ target: card, isIntersecting: false }]);
  built[0].fire([{ target: card, isIntersecting: false }]);
  built[0].fire([{ target: card, isIntersecting: true }]);
  expect(seen).toEqual([false, true]);
});

test("a card that starts parked is told as soon as it comes near", () => {
  const { built, factory } = fakeObservers();
  const watch = createNearViewport(factory);

  const card = node("card");
  const seen: boolean[] = [];
  watch.watch(card, false, (near) => seen.push(near));

  built[0].fire([{ target: card, isIntersecting: true }]);
  expect(seen).toEqual([true]);
});

test("unwatching stops the reports and releases the element", () => {
  const { built, factory } = fakeObservers();
  const watch = createNearViewport(factory);

  const card = node("card");
  const seen: boolean[] = [];
  const stop = watch.watch(card, true, (near) => seen.push(near));

  stop();
  expect(built[0].unobserved).toEqual([card]);
  expect(watch.size()).toBe(0);

  // An entry still in flight for an unmounted card is dropped, not dispatched
  // into a component that is gone.
  built[0].fire([{ target: card, isIntersecting: false }]);
  expect(seen).toEqual([]);

  // Unwatching twice is a no-op — an effect cleanup can run after the element
  // was already released.
  stop();
  expect(built[0].disconnected).toBe(1);
});

test("the observer is disconnected once the last card goes, and rebuilt after", () => {
  const { built, factory } = fakeObservers();
  const watch = createNearViewport(factory);

  const a = node("a");
  const b = node("b");
  const stopA = watch.watch(a, true, () => {});
  const stopB = watch.watch(b, true, () => {});

  stopA();
  expect(built[0].disconnected).toBe(0);
  stopB();
  expect(built[0].disconnected).toBe(1);
  expect(built).toHaveLength(1);

  // A control change swaps the whole grid out and back; the next card builds a
  // fresh observer rather than reusing the disconnected one.
  watch.watch(node("c"), true, () => {});
  expect(built).toHaveLength(2);
  expect(built[1].disconnected).toBe(0);
});

test("the margin is wider than the load-more sentinel's", () => {
  // Missing a page load costs a spinner; missing a thumbnail costs a blank card
  // the viewer is already looking at.
  expect(NEAR_VIEWPORT_MARGIN_PX).toBeGreaterThan(600);
});
