// The canvas page's URL: /<handle>/<channel>/canvas.

const CANVAS_PATH = /^\/[^/]+\/\d+\/canvas\/?$/;

export function canvasPath(channelPath: string): string {
  return `${channelPath.replace(/\/$/, "")}/canvas`;
}

// The canvas runs full-bleed with its own chrome, so the root layout drops the
// nav bar, footer and mobile bottom bar there, as it does on the hero routes.
export function isCanvasPath(pathname: string | null): boolean {
  return pathname !== null && CANVAS_PATH.test(pathname);
}

// The thread id in a `?thread=` value (the first, if repeated), or null when
// it isn't a positive whole number.
export function threadParam(value: string | string[] | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The canvas page opened on a thread: where a notification's channel link is
// sent on.
export function canvasThreadHref(channelPath: string, threadId: number): string {
  return `${canvasPath(channelPath)}?thread=${threadId}`;
}
