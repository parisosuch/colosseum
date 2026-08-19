import { Github } from "lucide-react";

import { cn } from "@/lib/utils";

// Renders a GitHub repo or account. A screenshot of github.com is mostly nav
// bars and sidebars, so this is a card built from what the API returned when
// the block was added: the owner's avatar (stored in our own blob storage), the
// repo or account name, its description, and a repo's primary language.
//
// No stars, forks, or issue counts. Metadata is captured once and never
// refreshed, so a count here would freeze on the day the block was added.
export default function GitHubBlock({
  url,
  title,
  description,
  image,
  language,
  compact = false,
}: {
  url: string;
  title: string;
  description?: string;
  image?: string;
  language?: string;
  compact?: boolean;
}) {
  // A repo title is "owner/repo"; splitting it lets the card lean on the repo
  // name, which is the part someone scans for. An account title has no slash
  // and stays whole.
  const slash = title.indexOf("/");
  const owner = slash > 0 ? title.slice(0, slash) : null;
  const name = slash > 0 ? title.slice(slash + 1) : title;

  // An avatar alone says nothing about where the block came from — the mark is
  // what makes a card in a mixed grid read as GitHub at a glance. It badges the
  // avatar's corner, and stands in for the avatar entirely when the account
  // published none (or we couldn't fetch it).
  const mark = (
    <span
      className={cn(
        "absolute bottom-0 right-0 flex items-center justify-center rounded-full",
        // Ringed in the card's own background so the mark separates from a busy
        // avatar instead of dissolving into it.
        "bg-foreground text-background ring-2 ring-background",
        compact ? "size-5" : "size-8",
      )}
    >
      <Github className={compact ? "size-3" : "size-5"} />
    </span>
  );

  const avatar = (
    <div className="relative">
      {image ? (
        <img
          src={compact ? `${image}?thumb` : image}
          alt=""
          className="aspect-square w-full rounded-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-full bg-foreground text-background">
          <Github className={compact ? "size-6" : "size-10"} />
        </div>
      )}
      {/* Only badge a real avatar: over the fallback it would be the same mark
          twice, one inside the other. */}
      {image ? mark : null}
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-1/2 max-w-24">{avatar}</div>
        <span className="max-w-full break-words font-mono text-sm">
          {owner ? <span className="text-muted-foreground">{owner}/</span> : null}
          <span className="font-medium">{name}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 p-6 text-center">
      <div className="w-32">{avatar}</div>
      <h2 className="break-words font-mono text-xl">
        {owner ? <span className="text-muted-foreground">{owner}/</span> : null}
        <span className="font-medium">{name}</span>
      </h2>
      {description ? (
        <p className="line-clamp-6 max-w-prose break-words text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {language ? (
        <span className="text-xs font-mono text-muted-foreground border rounded-full px-2 py-0.5">
          {language}
        </span>
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:no-underline"
      >
        <Github className="size-3.5" />
        View on GitHub
      </a>
    </div>
  );
}
