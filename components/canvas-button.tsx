"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PrefetchOptions } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { Shapes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canvasPath } from "@/lib/canvas/route";
import {
  rememberOpenedFrom,
  runCanvasTransition,
  saveChannelSnapshot,
  visibleRect,
} from "@/lib/canvas/transition";

// The channel action row's way into the canvas. A real link, so a middle-click
// or cmd+click opens the canvas in a new tab; a plain click runs the open
// transition, with the board growing out of the part of the grid on screen.
export default function CanvasButton({
  channelPath,
  channelHref,
  loaded,
  boardRef,
}: {
  channelPath: string;
  // The channel URL with its current query, which Back returns to.
  channelHref: string;
  // How many blocks the board has loaded, so Back can load as many again
  // before restoring the scroll.
  loaded: number;
  boardRef: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const href = canvasPath(channelPath);
  // A full prefetch: the page is dynamic, and the default only fetches up to
  // its loading boundary, which left the click waiting ~400ms on the server
  // render with the old page frozen under the transition.
  const prefetch = () =>
    router.prefetch(href, { kind: "full" as unknown as PrefetchOptions["kind"] });

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" asChild>
          <Link
            href={href}
            prefetch={false}
            aria-label="Open canvas"
            // Warm the route on intent, so the click renders the board straight
            // away and the transition has nothing to wait for.
            onPointerEnter={prefetch}
            onFocus={prefetch}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              const root = document.querySelector<HTMLElement>("[data-scroll-root]");
              saveChannelSnapshot(channelHref, { scrollTop: root?.scrollTop ?? 0, loaded });
              rememberOpenedFrom(channelPath, channelHref);
              runCanvasTransition("open", "canvas", () => router.push(href), {
                proxyRect: visibleRect(boardRef.current),
              });
            }}
          >
            <Shapes />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open canvas</TooltipContent>
    </Tooltip>
  );
}
