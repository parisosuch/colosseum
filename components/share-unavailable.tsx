import { LinkIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

// What a share link shows when it doesn't open anything: unknown, revoked or
// expired (deliberately one message, so a page can't be used to tell which), or
// a client that has presented too many dead links in a row.
export default function ShareUnavailable({ limited = false }: { limited?: boolean }) {
  return (
    <div className="w-full p-6 sm:p-12">
      <EmptyState
        icon={LinkIcon}
        title={limited ? "Too many tries" : "This link doesn't work"}
        description={
          limited
            ? "Wait a minute, then open the link again."
            : "It may have expired or been revoked. Ask whoever sent it for a new one."
        }
      />
    </div>
  );
}
