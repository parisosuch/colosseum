// Sort keys for the channel board's manual block order.
//
// A block's place in a hand-arranged channel is a string, not an integer, so
// dropping a card between two others writes exactly one row: the moved block
// gets a key strictly between its new neighbours' keys and nothing else in the
// channel is touched. Renumbering a 400-block channel on every drag would be
// 400 UPDATEs and would lose to any concurrent reorder; this loses at most the
// one row two people dragged at the same time.
//
// A key is `IIIIII` + an optional fraction: six base-36 digits of integer part
// at fixed width, then however many digits of fraction the splits have needed.
// Fixed width is what makes plain string comparison agree with numeric order —
// "b00000" < "c00000" as text because the integer parts are the same length —
// and it is why keys are compared with `<` here and with a plain ORDER BY in
// Postgres, with no parsing on either side.
//
// The alphabet is deliberately `0-9a-z` and nothing else. Postgres orders text
// by the database's collation, and a non-C collation does not sort arbitrary
// ASCII by byte: under en_US.UTF-8 "a" sorts before "B", so a base-62 key with
// mixed case would order differently in the database than it does in JS. Digits
// and lowercase letters (no punctuation, no case to fold) sort the same way
// under C, en_US.UTF-8 and ICU alike, so the ordering does not depend on how
// the instance's database was initialised. Widening the alphabet would break
// that and would need an explicit COLLATE "C" on both the index and every
// ORDER BY.

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const ZERO = DIGITS[0];

// Digits of integer part. 36^6 ≈ 2.2e9 slots, of which the start below sits in
// the middle: about 1.1 billion insertions at each end of a channel before the
// integer part runs out. A channel hits every other limit in the app long
// before that, and running out throws rather than corrupting the order.
const INT_LEN = 6;

// The first key in an empty channel. Mid-alphabet so there is as much room to
// prepend as to append — new blocks go to the top of a channel, so the head is
// the end that actually gets used.
export const FIRST_POSITION = DIGITS[18] + ZERO.repeat(INT_LEN - 1);

// Whether `key` is something this module produced: the fixed-width integer
// part, an optional fraction, and no trailing zero. A trailing zero would be a
// key with no room below it inside its own prefix, which is exactly the case
// midpoint() cannot split, so it is rejected at the door rather than discovered
// three splits later.
export function isPosition(key: string): boolean {
  if (key.length < INT_LEN) return false;
  for (const ch of key) {
    if (!DIGITS.includes(ch)) return false;
  }
  return key.length === INT_LEN || !key.endsWith(ZERO);
}

function assertPosition(key: string): void {
  if (!isPosition(key)) {
    throw new Error(`Not a position key: ${JSON.stringify(key)}`);
  }
}

function intPart(key: string): string {
  return key.slice(0, INT_LEN);
}

function fracPart(key: string): string {
  return key.slice(INT_LEN);
}

// The next integer part up, or null at the top of the range.
function incrementInt(int: string): string | null {
  const digits = int.split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) + 1;
    if (d < BASE) {
      digits[i] = DIGITS[d];
      return digits.join("");
    }
    digits[i] = ZERO;
  }
  return null;
}

// The next integer part down, or null at the bottom of the range.
function decrementInt(int: string): string | null {
  const digits = int.split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) - 1;
    if (d >= 0) {
      digits[i] = DIGITS[d];
      return digits.join("");
    }
    digits[i] = DIGITS[BASE - 1];
  }
  return null;
}

// A fraction strictly between `a` and `b`, both read as digits after an implied
// point and `b === null` meaning 1. Neither may end in a zero digit, and the
// result never does either, so the output can be split again.
//
// The recursion is the ordinary "walk the shared prefix, then split the first
// digit that differs" — with the wrinkle that consecutive digits (4 and 5, say)
// have nothing between them, so the split moves one digit deeper instead. That
// is where a key gains a character: repeatedly dropping a block into the same
// gap lengthens the key by roughly a digit every few moves. Nothing is lost —
// there is no precision to run out of, which is the whole reason this is a
// string and not a float — but a gap worked over for long enough grows a long
// key, and the only cure is renumbering the channel.
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`Cannot split ${JSON.stringify(a)}..${JSON.stringify(b)}`);
  }
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new Error("Fraction ends in a zero digit");
  }

  if (b !== null) {
    // Shared prefix, with `a` padded out with zeros: `a` can end before `b`
    // does, and a missing digit is a zero.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }

  const digitA = a === "" ? 0 : DIGITS.indexOf(a[0]);
  const digitB = b === null ? BASE : DIGITS.indexOf(b[0]);
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  // The two leading digits are neighbours. If `b` has more digits, its own
  // leading digit already sits in the gap; otherwise go a digit deeper on `a`.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

// A key strictly between `a` and `b`, either of which is null at the ends of
// the channel. Both nulls means an empty channel.
//
// Inserting at either end is the cheap case: it moves the integer part by one
// and the key stays six characters, which matters because every new block is
// added at the head. Only splitting an interior gap grows a fraction.
export function positionBetween(a: string | null, b: string | null): string {
  if (a !== null) assertPosition(a);
  if (b !== null) assertPosition(b);
  if (a !== null && b !== null && a >= b) {
    throw new Error(`Positions out of order: ${a} >= ${b}`);
  }

  if (a === null) {
    if (b === null) return FIRST_POSITION;
    const intB = intPart(b);
    // `b` has a fraction, so its own integer part is already below it.
    if (fracPart(b) !== "") return intB;
    const below = decrementInt(intB);
    if (below === null) {
      throw new Error("No room left at the start of this channel.");
    }
    return below;
  }

  const intA = intPart(a);
  const above = incrementInt(intA);
  if (b === null) {
    // Past the last integer there is still the fraction above `a` inside its
    // own integer, which is where the top of the range degrades to: shorter
    // keys are gone, correct ordering is not.
    return above ?? intA + midpoint(fracPart(a), null);
  }

  const intB = intPart(b);
  if (intA === intB) {
    return intA + midpoint(fracPart(a), fracPart(b));
  }
  // A whole integer sits in the gap; use it and keep the key short.
  if (above !== null && above < b) return above;
  return intA + midpoint(fracPart(a), null);
}

// `count` keys in ascending order, all above `after` (or from the start of the
// range when it is null). Backs the backfill, which places a run of blocks
// below whatever the channel already holds in one pass rather than calling
// positionBetween in a loop and re-reading the tail each time.
export function positionsAfter(after: string | null, count: number): string[] {
  const keys: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    prev = positionBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}
