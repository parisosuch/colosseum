// Scheduling for the channel board's screenshot poll: how long to wait before
// the next round, when to stop, and when to sit a round out because nobody is
// looking at the tab.
//
// A url block can arrive with no cached preview — the REST API captures them
// asynchronously, so a block created outside this session may take a few
// seconds to a couple of minutes before one lands. The board polls
// `getScreenshotsForUrls` until it does. The React side — the effect that runs
// the rounds and holds the per-URL attempt counts — lives in
// components/channel-board.tsx, so this module stays unit-testable under the
// suite's `--conditions=react-server` (that build of React has no hooks).

// A capture that is going to land usually lands in the first few seconds, so
// the retries start fast and stretch out from there. 1s doubling to a 30s
// ceiling puts rounds at t = 0, 1, 3, 7, 15, 31, 61, 91, 121, 151s.
export const SCREENSHOT_POLL_INITIAL_MS = 1_000;
export const SCREENSHOT_POLL_MAX_MS = 30_000;

// Rounds a URL gets before the board settles on "no preview". Ten spans ~2.5
// minutes of wall clock, and five of them land inside the first 15 seconds
// where captures actually resolve — a flat 5s cadence fits only three there,
// and needed 60 requests to cover its 5 minutes.
export const SCREENSHOT_MAX_ATTEMPTS = 10;

// Delay before the round that follows `attempts` completed ones.
export function screenshotPollDelayMs(attempts: number): number {
  const step = Math.max(0, attempts - 1);
  return Math.min(SCREENSHOT_POLL_INITIAL_MS * 2 ** step, SCREENSHOT_POLL_MAX_MS);
}

export type ScreenshotPollDecision =
  | { kind: "settled" }
  | { kind: "await-visible" }
  | { kind: "schedule"; delayMs: number };

// What to do after a round. `pendingAttempts` is the lowest attempt count among
// the URLs still waiting on a capture, or null when none are — the lowest wins
// so a page of blocks that just scrolled in gets the fast early retries instead
// of inheriting the stretched-out cadence of a URL that has been pending for
// minutes. A hidden tab waits for the tab to come back rather than holding a
// timer, and nothing is spent in the meantime — the attempt cap counts rounds
// that actually queried, so a tab restored after ten minutes still has its
// remaining attempts.
export function nextScreenshotPoll(
  pendingAttempts: number | null,
  hidden: boolean,
): ScreenshotPollDecision {
  if (pendingAttempts === null) return { kind: "settled" };
  if (hidden) return { kind: "await-visible" };
  return { kind: "schedule", delayMs: screenshotPollDelayMs(pendingAttempts) };
}

// The slice of `document` the visibility wait needs, so the scheduling can be
// tested without a DOM.
export type VisibilityTarget = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

// Call `resume` the next time the document becomes visible. Returns the
// unsubscribe, so an effect can hand it straight back as its cleanup.
export function whenVisible(target: VisibilityTarget, resume: () => void): () => void {
  const onChange = () => {
    if (!target.hidden) resume();
  };
  target.addEventListener("visibilitychange", onChange);
  return () => target.removeEventListener("visibilitychange", onChange);
}
