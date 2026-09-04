"use client";

import { useEffect } from "react";

// iOS Safari ignores the viewport's user-scalable/maximum-scale for
// accessibility, so pinch-zoom still works there. Preventing the iOS-only
// `gesturestart` event blocks pinch-zoom without touching scroll (which uses
// touchmove, not gesture events). Double-tap zoom is handled by
// `touch-action: manipulation` in globals.css. Renders nothing.
export function NoZoomGuard() {
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", prevent);
    return () => document.removeEventListener("gesturestart", prevent);
  }, []);

  return null;
}
