import { GlobeIcon } from "lucide-react";

// Shown in place of a link block's screenshot when there is none — a host that
// blocks capture, a dead site, a render that failed. A thin bordered strip
// reading "No screenshot available" looks like the block is broken; this fills
// the space the picture would have taken and names the site, so it reads as a
// link whose preview didn't come rather than as a failure.
export default function LinkPreviewEmpty({ url }: { url?: string | null }) {
  const host = url?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed p-10 text-center">
      <GlobeIcon className="size-8 text-muted-foreground" />
      {host ? <span className="font-mono text-sm break-all">{host}</span> : null}
      <span className="text-sm text-muted-foreground">No preview for this link.</span>
    </div>
  );
}
