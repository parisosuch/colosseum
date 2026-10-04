import { expect, test } from "bun:test";

import { LayeredMap } from "./layered-map";

test("a layered map reads like the Map it stands for, through edits and compaction", () => {
  let m = LayeredMap.from<string, number>([]);
  const plain = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const key = `k${(i * 37) % 300}`;
    const value = i % 5 === 0 ? undefined : i;
    m = m.with([[key, value]]);
    if (value === undefined) plain.delete(key);
    else plain.set(key, value);
    if (i % 97 === 0) {
      expect(m.size).toBe(plain.size);
      expect(new Map(m)).toEqual(plain);
      expect([...m.keys()].sort()).toEqual([...plain.keys()].sort());
    }
  }
  for (const [k, v] of plain) {
    expect(m.get(k)).toBe(v);
    expect(m.has(k)).toBe(true);
  }
  expect(m.has("missing")).toBe(false);
});

test("an older map is unchanged by the edits made from it", () => {
  const a = LayeredMap.from([["x", 1]]);
  const b = a.with([
    ["x", 2],
    ["y", 3],
  ]);
  expect(a.get("x")).toBe(1);
  expect(a.has("y")).toBe(false);
  expect(b.get("x")).toBe(2);
  expect(b.size).toBe(2);
});
