// The open and close transitions between a channel page and its canvas, on the
// View Transitions API. Client only.
//
// The navigation runs inside `document.startViewTransition`, whose update
// callback waits until the destination page says it has painted
// (`transitionReady`), so the new snapshot is the page and not a loading state.
// <html data-canvas-vt> names the transition while it runs; the CSS in
// globals.css hangs every view-transition-name and keyframe off it.
//
// Without the API the navigation just happens. Under reduced motion it's a
// 200ms crossfade with nothing moving or scaling.

export type CanvasTransition = "open" | "close";
type Target = "canvas" | "channel";

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    skipTransition: () => void;
  };
};

// The destination waits at most this long before the transition gives up
// waiting and snapshots whatever is there. A cold route with no prefetch takes
// longer than the animation is worth.
const READY_TIMEOUT_MS = 1200;

let waiting: { target: Target; resolve: () => void } | null = null;
let running = false;
// The rectangle the board shrinks into on close, drawn by the channel page.
let landing: HTMLElement | null = null;

export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

// Which transition is running, if any. The channel page reads it to decide
// whether to draw the rectangle the board shrinks into.
export function activeCanvasTransition(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.dataset.canvasVt;
}

// A fixed, empty box with the board's transition name, standing in for the
// visible part of the channel grid. The grid itself runs far below the fold,
// and its snapshot would be the whole list; this gives the board a window-sized
// rectangle to grow from (or shrink into) instead.
export function createBoardProxy(rect: DOMRect | null): HTMLElement | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const el = document.createElement("div");
  el.dataset.vt = "board";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: "none",
    borderRadius: "8px",
  });
  document.body.appendChild(el);
  return el;
}

// The part of `el` that's inside the window.
export function visibleRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = Math.max(0, r.top);
  const left = Math.max(0, r.left);
  const bottom = Math.min(window.innerHeight, r.bottom);
  const right = Math.min(window.innerWidth, r.right);
  if (bottom <= top || right <= left) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

// Navigate inside a transition. `navigate` changes the route; the transition
// then waits for `transitionReady(target)`. `proxyRect` is where the board
// grows from on open; without it (no grid on screen) the open is a crossfade.
export function runCanvasTransition(
  kind: CanvasTransition,
  target: Target,
  navigate: () => void,
  { proxyRect = null }: { proxyRect?: DOMRect | null } = {},
): void {
  const doc = document as DocumentWithVT;
  if (!doc.startViewTransition || running) {
    navigate();
    return;
  }
  const mode = prefersReducedMotion() || (kind === "open" && !proxyRect) ? "fade" : kind;
  running = true;
  document.documentElement.dataset.canvasVt = mode;
  const proxy = mode === "open" ? createBoardProxy(proxyRect) : null;

  let transition: ReturnType<NonNullable<DocumentWithVT["startViewTransition"]>>;
  try {
    transition = doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          // The old snapshot is taken; the proxy has done its job and must be
          // gone before the new one, which has its own board.
          proxy?.remove();
          const done = () => {
            if (waiting?.resolve === done) waiting = null;
            resolve();
          };
          waiting = { target, resolve: done };
          setTimeout(done, READY_TIMEOUT_MS);
          navigate();
        }),
    );
  } catch {
    proxy?.remove();
    running = false;
    delete document.documentElement.dataset.canvasVt;
    navigate();
    return;
  }
  const cleanup = () => {
    proxy?.remove();
    landing?.remove();
    landing = null;
    running = false;
    delete document.documentElement.dataset.canvasVt;
  };
  transition.finished.then(cleanup, cleanup);
}

// On close, the channel page marks where the board lands: the visible part of
// its grid, once the scroll is back where it was. Removed when the transition
// ends.
export function setLandingRect(rect: DOMRect | null): void {
  landing?.remove();
  landing = activeCanvasTransition() === "close" ? createBoardProxy(rect) : null;
}

// Called by the destination page once it has painted what the transition
// should land on.
export function transitionReady(target: Target): void {
  if (waiting?.target === target) {
    const { resolve } = waiting;
    waiting = null;
    // A task later rather than a frame later: the browser holds rendering
    // while the update callback is pending, so requestAnimationFrame wouldn't
    // fire until the timeout.
    setTimeout(resolve, 0);
  }
}

// Where the canvas was opened from, for this tab's lifetime in the app. Set by
// the canvas button. Back uses the browser history when it's set for this
// channel, and pushes the channel page otherwise (a canvas opened from a
// shared link has nothing behind it to go back to).
let openedFrom: { channelPath: string; href: string } | null = null;

export function rememberOpenedFrom(channelPath: string, href: string): void {
  openedFrom = { channelPath, href };
}

export function openedFromChannel(channelPath: string): string | null {
  return openedFrom?.channelPath === channelPath ? openedFrom.href : null;
}

// The channel page's scroll and how much of it was loaded, saved on the way
// into the canvas and read back when Back returns to it. sessionStorage, so a
// reload of the channel page in between doesn't lose it either.
export type ChannelSnapshot = { scrollTop: number; loaded: number; savedAt: number };

const SNAPSHOT_KEY = "colosseum:channel-snapshot:";
const BACK_KEY = "colosseum:canvas-back";
// A snapshot older than this is from some earlier visit, not the one Back is
// returning to.
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

export function saveChannelSnapshot(href: string, snapshot: Omit<ChannelSnapshot, "savedAt">) {
  try {
    sessionStorage.setItem(
      SNAPSHOT_KEY + href,
      JSON.stringify({ ...snapshot, savedAt: Date.now() } satisfies ChannelSnapshot),
    );
  } catch {
    // Private mode or a full quota: Back still works, at the top of the page.
  }
}

// Marks that the next channel page load is a return from the canvas, so it
// restores its snapshot. A fresh visit to the same URL starts at the top.
export function markReturningFromCanvas(channelPath: string): void {
  try {
    sessionStorage.setItem(BACK_KEY, channelPath);
  } catch {
    // see above
  }
}

// The snapshot to restore, if this load is a return from the canvas. Read
// without removing it, since React runs a dev-mode effect twice; the caller
// clears it once the scroll is back.
export function peekChannelSnapshot(channelPath: string, href: string): ChannelSnapshot | null {
  try {
    if (sessionStorage.getItem(BACK_KEY) !== channelPath) return null;
    const raw = sessionStorage.getItem(SNAPSHOT_KEY + href);
    if (!raw) return null;
    const snap = JSON.parse(raw) as ChannelSnapshot;
    if (typeof snap.scrollTop !== "number" || Date.now() - snap.savedAt > SNAPSHOT_TTL_MS) {
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function clearChannelSnapshot(href: string): void {
  try {
    sessionStorage.removeItem(BACK_KEY);
    sessionStorage.removeItem(SNAPSHOT_KEY + href);
  } catch {
    // see above
  }
}
