// A popstate listener that runs before Next's own.
//
// The browser's Back from the canvas should play the close transition, which
// means starting it before the channel page replaces the canvas. Next handles
// popstate with a listener on window, and React renders that navigation
// synchronously inside the event, so a listener the canvas page adds later
// runs after the page is already gone. Listeners on window run in the order
// they were added, so this one is added when the module first loads, from the
// root layout, before Next's router mounts.
//
// The canvas page sets an interceptor while it's open. When it takes an event,
// Next never sees that one; the interceptor hands Next a copy (`replay`) once
// the transition has captured the old page.

type Interceptor = (event: PopStateEvent, replay: () => void) => boolean;

let interceptor: Interceptor | null = null;
let replaying = false;

function onPopState(event: PopStateEvent) {
  if (replaying || !interceptor) return;
  const state: unknown = event.state;
  const replay = () => {
    replaying = true;
    try {
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    } finally {
      replaying = false;
    }
  };
  if (interceptor(event, replay)) event.stopImmediatePropagation();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", onPopState);
}

export function setPopStateInterceptor(fn: Interceptor | null): void {
  interceptor = fn;
}
