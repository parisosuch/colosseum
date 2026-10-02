import { LinkIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

// What a share link shows when it doesn't open anything: unknown, revoked,
// expired, or its user banned. Deliberately one message, so the page can't be
// used to tell which.
export default function ShareUnavailable() {
  return (
    <div className="w-full p-6 sm:p-12">
      <EmptyState
        icon={LinkIcon}
        title="This link doesn't work"
        description="It may have expired or been revoked. Ask whoever sent it for a new one."
      />
    </div>
  );
}
