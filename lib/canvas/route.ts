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
