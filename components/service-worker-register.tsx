"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) once, in production only — a SW in
// dev fights Turbopack's HMR and caches half-built assets. Renders nothing.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.error("Service worker registration failed:", e);
    });
  }, []);

  return null;
}
