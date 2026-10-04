import { expect, test } from "bun:test";
import * as Y from "yjs";

import { DocIndex } from "@/lib/canvas/doc-state";
import { setGeometry } from "@/lib/canvas/elements";
import { bigBoard } from "@/lib/canvas/test-doc";
import { CanvasStore } from "./canvas-store";

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// What one element's write costs the store, from the transaction to the new
// DocState: a drag frame, a nudge, a restyle. "rebuild" is every element read,
// sorted and laid out again, which is what each write cost before the store
// went incremental.
test("a single-element write stays under 2ms at 5,000 elements", () => {
  const rows: string[] = [];
  let at5000 = Infinity;
  for (const n of [500, 2000, 5000]) {
    const store = new CanvasStore(1, "write", "u");
    Y.applyUpdate(store.doc, Y.encodeStateAsUpdate(bigBoard(n)));
    const ids = [...store.docState.elements.keys()].filter((id) => id.startsWith("e"));
    // Warm up.
    for (let i = 0; i < 20; i++) setGeometry(store.doc, [{ id: ids[i], x: i }], store.origin);

    const incremental: number[] = [];
    for (let i = 0; i < 200; i++) {
      const id = ids[(i * 7) % ids.length];
      const t = performance.now();
      setGeometry(store.doc, [{ id, x: 1000 + i }], store.origin);
      incremental.push(performance.now() - t);
    }

    const index = new DocIndex();
    index.rebuild(store.doc);
    const rebuild: number[] = [];
    for (let i = 0; i < 10; i++) {
      setGeometry(store.doc, [{ id: ids[i], x: 2000 + i }], store.origin);
      const t = performance.now();
      index.rebuild(store.doc);
      rebuild.push(performance.now() - t);
    }

    const inc = median(incremental);
    if (n === 5000) at5000 = inc;
    rows.push(
      `${String(n).padStart(5)} elements: ${inc.toFixed(3)}ms incremental, ${median(rebuild).toFixed(1)}ms rebuild`,
    );
    store.destroy();
  }
  console.log(`median per single-element write\n${rows.join("\n")}`);
  expect(at5000).toBeLessThan(2);
}, 60_000);
