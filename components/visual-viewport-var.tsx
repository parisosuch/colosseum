"use client";

import { useEffect } from "react";

// Publishes what the software keyboard is doing to the viewport, as two CSS
// variables: `--visual-vh`, the height actually left for content, and
// `--keyboard-inset`, how much is obscured at the bottom.
//
// `dvh` is not that. It follows the browser's own chrome collapsing, which is
// what it was added for, but on iOS the software keyboard shrinks the visual
// viewport while leaving the layout viewport alone — so `dvh` doesn't move, and
// a bottom sheet sized in `dvh` keeps its full height with its lower half
// underneath the keyboard. That is #490: the field you are typing into ends up
// off-screen.
//
// `visualViewport.height` is the one measurement that does shrink. Both
// variables are needed, and the height alone is not enough: a bottom sheet is
// anchored to the *layout* viewport's bottom edge, so shrinking it leaves the
// sheet exactly where it was, still behind the keyboard. It has to be lifted by
// the obscured amount as well. (Measured, not assumed — capping the height on
// its own moved the sheet's top down and left its bottom at the screen edge.)
//
// Published as variables rather than applied directly so the sheets stay styled
// in CSS, and so anything else that needs this later reads the same numbers.
//
// Absent (no visualViewport, or before the first effect runs) every consumer
// falls back to its own dvh value and a zero inset, which is the current
// behaviour — so this can only narrow and lift a panel, never break one.
//
// Renders nothing.
export function VisualViewportVar() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const publish = () => {
      const root = document.documentElement;
      root.style.setProperty("--visual-vh", `${vv.height}px`);
      // What the keyboard covers at the bottom: everything below the visual
      // viewport's lower edge. offsetTop matters because iOS scrolls the visual
      // viewport up to keep a focused field visible, which moves that edge.
      // Clamped at 0 so a viewport taller than the layout (which happens
      // mid-bounce on iOS) never pushes the sheet down off the screen.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    publish();

    // `resize` covers the keyboard opening and closing and the orientation
    // change. `scroll` covers iOS shifting the visual viewport up to keep a
    // focused field visible, which changes the offset rather than the height —
    // cheap to recompute, and it keeps the variable honest mid-gesture.
    vv.addEventListener("resize", publish);
    vv.addEventListener("scroll", publish);
    return () => {
      vv.removeEventListener("resize", publish);
      vv.removeEventListener("scroll", publish);
      document.documentElement.style.removeProperty("--visual-vh");
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  return null;
}
