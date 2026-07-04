// Prefixed, timestamped console logging for the parts of the app worth being
// able to debug in prod without redeploying a temporary console.log first —
// API routes and background work like screenshot capture. Plain
// console.log/error under the hood: it shows up in `docker logs` / Coolify's
// log viewer with no extra setup, no log-shipping service, no dependency.
//
// Debugging note: in this repo's compose setup, `entrypoint.sh` execs into
// `bun run start`, which itself spawns Next's server as a *child* process —
// so PID 1 inside the container isn't the process actually writing these
// logs. Use Coolify's (or your platform's) log viewer rather than tailing
// /proc/1/fd/* by PID.
function ts(): string {
  return new Date().toISOString();
}

export function logInfo(context: string, message: string, extra?: Record<string, unknown>): void {
  console.log(`[${ts()}] [${context}] ${message}`, extra ?? "");
}

export function logError(context: string, message: string, error: unknown): void {
  console.error(`[${ts()}] [${context}] ${message}:`, error);
}
