import { buttonVariants } from "@/components/ui/button";

// Shown by the service worker when a navigation fails with no cached page.
// Static by design so it's always available offline.
export default function OfflinePage() {
  return (
    <div className="w-full flex-1 flex items-center justify-center p-12">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="space-y-2">
          <h1 className="text-display">You&apos;re offline</h1>
          <p className="text-muted-foreground">
            Colosseum can&apos;t reach the network right now. Reconnect and try again.
          </p>
        </div>
        {/* A bare GET form, not a button with an onClick: this page is served in
            place of the page that failed, and its own JS chunk may never have
            been cached, so anything needing hydration would be a dead control.
            A form with no action re-requests the current URL — the one the user
            was trying to reach. */}
        <form>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Try again
          </button>
        </form>
      </div>
    </div>
  );
}
