// A read-only map that is cheap to copy with a few entries changed. The canvas
// keeps one snapshot of every element, box and route per doc change, and
// copying a 5,000-entry Map on every keystroke or drag frame costs more than
// the rest of the update. A LayeredMap is a shared base that never changes
// plus a small layer of changes on top; `with` copies only the layer, and folds
// it into a new base once it grows past a fraction of the base, so the cost per
// update stays proportional to what changed.

const GONE: unique symbol = Symbol("gone");
type Slot<V> = V | typeof GONE;

export class LayeredMap<K, V> implements ReadonlyMap<K, V> {
  private constructor(
    private readonly base: ReadonlyMap<K, V>,
    private readonly top: ReadonlyMap<K, Slot<V>>,
    readonly size: number,
  ) {}

  static from<K, V>(entries: Iterable<readonly [K, V]>): LayeredMap<K, V> {
    const base = new Map<K, V>(entries);
    return new LayeredMap(base, new Map(), base.size);
  }

  static empty<K, V>(): LayeredMap<K, V> {
    return new LayeredMap(new Map(), new Map(), 0);
  }

  get(key: K): V | undefined {
    const t = this.top.get(key);
    if (t !== undefined) return t === GONE ? undefined : t;
    return this.base.get(key);
  }

  has(key: K): boolean {
    const t = this.top.get(key);
    if (t !== undefined) return t !== GONE;
    return this.base.has(key);
  }

  // A copy with `changes` applied: a value sets the key, undefined removes it.
  with(changes: Iterable<readonly [K, V | undefined]>): LayeredMap<K, V> {
    const top = new Map(this.top);
    let size = this.size;
    for (const [k, v] of changes) {
      const had = this.has(k);
      if (v === undefined) {
        if (!had) continue;
        size--;
        if (this.base.has(k)) top.set(k, GONE);
        else top.delete(k);
      } else {
        if (!had) size++;
        top.set(k, v);
      }
    }
    if (top.size > 32 && top.size * 8 > this.base.size) {
      const base = new Map<K, V>();
      for (const [k, v] of this.base) {
        const t = top.get(k);
        if (t === undefined) base.set(k, v);
        else if (t !== GONE) base.set(k, t);
      }
      for (const [k, t] of top) if (t !== GONE && !this.base.has(k)) base.set(k, t);
      return new LayeredMap(base, new Map(), size);
    }
    return new LayeredMap(this.base, top, size);
  }

  // Iterating a layered map walks the base and checks the layer per entry,
  // which is slow enough at 5,000 entries to matter when it happens on every
  // write, so the merged entries are worked out once per map and kept.
  private merged: [K, V][] | null = null;

  private all(): [K, V][] {
    if (this.merged) return this.merged;
    const out: [K, V][] = [];
    for (const [k, v] of this.base) {
      const t = this.top.get(k);
      if (t === undefined) out.push([k, v]);
      else if (t !== GONE) out.push([k, t]);
    }
    for (const [k, t] of this.top) if (t !== GONE && !this.base.has(k)) out.push([k, t]);
    this.merged = out;
    return out;
  }

  entries(): MapIterator<[K, V]> {
    if (this.top.size === 0) return this.base.entries();
    return this.all().values();
  }

  keys(): MapIterator<K> {
    if (this.top.size === 0) return this.base.keys();
    return this.all()
      .map(([k]) => k)
      .values();
  }

  values(): MapIterator<V> {
    if (this.top.size === 0) return this.base.values();
    return this.all()
      .map(([, v]) => v)
      .values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  forEach(fn: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [k, v] of this.entries()) fn(v, k, this);
  }
}
