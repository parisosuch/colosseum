import { expect, test } from "bun:test";

import { FIRST_POSITION, isPosition, positionBetween, positionsAfter } from "./fractional-index";

test("an empty channel starts mid-range, with room either side", () => {
  const first = positionBetween(null, null);
  expect(first).toBe(FIRST_POSITION);
  expect(isPosition(first)).toBe(true);
  // Both ends still have integers left, so neither prepend nor append has to
  // grow a fraction on the very first move.
  expect(positionBetween(null, first) < first).toBe(true);
  expect(positionBetween(first, null) > first).toBe(true);
});

test("keys at the ends of a channel stay six characters", () => {
  let head = positionBetween(null, null);
  let tail = head;
  for (let i = 0; i < 500; i++) {
    head = positionBetween(null, head);
    tail = positionBetween(tail, null);
    expect(head.length).toBe(6);
    expect(tail.length).toBe(6);
  }
  expect(head < tail).toBe(true);
});

test("splitting the same gap keeps ordering and grows the key slowly", () => {
  const a = positionBetween(null, null);
  const b = positionBetween(a, null);

  let upper = b;
  for (let i = 0; i < 200; i++) {
    const mid = positionBetween(a, upper);
    expect(a < mid).toBe(true);
    expect(mid < upper).toBe(true);
    expect(isPosition(mid)).toBe(true);
    upper = mid;
  }
  // No precision to run out of: 200 splits of one gap cost characters, not
  // correctness. The growth is sublinear — roughly a digit every few splits.
  expect(upper.length).toBeLessThan(6 + 200);
  expect(upper.length).toBeGreaterThan(6);
});

test("splitting alternating sides of a gap stays ordered", () => {
  let lo = positionBetween(null, null);
  let hi = positionBetween(lo, null);
  for (let i = 0; i < 200; i++) {
    const mid = positionBetween(lo, hi);
    expect(lo < mid).toBe(true);
    expect(mid < hi).toBe(true);
    if (i % 2 === 0) lo = mid;
    else hi = mid;
  }
});

test("a long run of random inserts stays sorted", () => {
  // A deterministic PRNG, so a failure is reproducible rather than a story
  // about a seed nobody wrote down.
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const keys = [positionBetween(null, null)];
  for (let i = 0; i < 2000; i++) {
    // Insert at a random slot, including both ends.
    const slot = Math.floor(rand() * (keys.length + 1));
    const before = slot === 0 ? null : keys[slot - 1];
    const after = slot === keys.length ? null : keys[slot];
    const key = positionBetween(before, after);
    keys.splice(slot, 0, key);
  }

  expect(keys.length).toBe(2001);
  expect(new Set(keys).size).toBe(keys.length);
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i - 1] < keys[i]).toBe(true);
    expect(isPosition(keys[i])).toBe(true);
  }
  // Sorting the keys as plain strings — which is all Postgres does — must give
  // back the order they were inserted in.
  expect([...keys].sort()).toEqual(keys);
});

test("moving one block writes one key and leaves the rest alone", () => {
  // Six blocks, then the last is dragged to the second slot. Only the moved
  // block's key changes; that is the whole point of the representation.
  const keys = positionsAfter(null, 6);
  const moved = positionBetween(keys[0], keys[1]);
  const after = [keys[0], moved, keys[1], keys[2], keys[3], keys[4]];
  expect([...after].sort()).toEqual(after);
  expect(keys.slice(0, 5)).toEqual([keys[0], keys[1], keys[2], keys[3], keys[4]]);
});

test("positionsAfter returns an ascending run above its anchor", () => {
  const anchor = positionBetween(null, null);
  const run = positionsAfter(anchor, 25);
  expect(run.length).toBe(25);
  expect([...run].sort()).toEqual(run);
  expect(anchor < run[0]).toBe(true);
  expect(run.every(isPosition)).toBe(true);
});

test("positionsAfter from nothing starts at the first key", () => {
  const run = positionsAfter(null, 3);
  expect(run[0]).toBe(FIRST_POSITION);
  expect([...run].sort()).toEqual(run);
});

test("out-of-order or malformed bounds are rejected, not silently split", () => {
  const a = positionBetween(null, null);
  const b = positionBetween(a, null);
  expect(() => positionBetween(b, a)).toThrow();
  expect(() => positionBetween(a, a)).toThrow();
  expect(() => positionBetween("nope", null)).toThrow();
  expect(() => positionBetween(null, "AAAAAA")).toThrow();
  // A trailing zero is the one shape with no room below it inside its own
  // prefix, so it can never be a stored key.
  expect(() => positionBetween("i000000", null)).toThrow();
});

test("isPosition accepts what this module produces and little else", () => {
  expect(isPosition("i00000")).toBe(true);
  expect(isPosition("i00000i")).toBe(true);
  expect(isPosition("i0000")).toBe(false); // too short
  expect(isPosition("i00000A")).toBe(false); // outside the alphabet
  expect(isPosition("i-00000")).toBe(false);
  expect(isPosition("i000000")).toBe(false); // trailing zero in the fraction
});

test("the head of the range runs out loudly", () => {
  // Walking to the bottom integer and asking for one more must throw rather
  // than wrap around and quietly put the block at the end of the channel.
  let key = "000000";
  expect(isPosition(key)).toBe(true);
  expect(() => positionBetween(null, key)).toThrow();
  // One integer up there is still room, and it lands below.
  key = "000001";
  expect(positionBetween(null, key)).toBe("000000");
});

test("the tail of the range degrades to a fraction instead of throwing", () => {
  const top = "zzzzzz";
  const next = positionBetween(top, null);
  expect(next > top).toBe(true);
  expect(isPosition(next)).toBe(true);
  expect(positionBetween(next, null) > next).toBe(true);
});
