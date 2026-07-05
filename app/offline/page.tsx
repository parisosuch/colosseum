// Shown by the service worker when a navigation fails with no cached page.
// Static by design so it's always available offline.
export default function OfflinePage() {
  return (
    <div className="w-full flex-1 flex items-center justify-center p-12">
      <div className="flex flex-col items-center space-y-2 text-center">
        <h1 className="text-display">You&apos;re offline</h1>
        <p className="text-muted-foreground">
          Colosseum can&apos;t reach the network right now. Reconnect and try again.
        </p>
      </div>
    </div>
  );
}
