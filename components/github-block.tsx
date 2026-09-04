import { Github } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  // Fallback when the account published no avatar, or we couldn't fetch it: the
  // GitHub mark filling the circle, so the card still has a subject.
  const avatar = image ? (
    <img
      src={compact ? `${image}?thumb` : image}
      alt=""
      className="aspect-square w-full rounded-full object-cover"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-full bg-foreground text-background">
      <Github className={compact ? "size-6" : "size-10"} />
    </div>
  );

  // The mark sits with the name rather than on the avatar: it says what kind of
  // block this is, which belongs next to the thing being named, not badged onto
  // someone's face. Inline rather than a flex child so a long repo name wrapping
  // to a second line leaves it beside the first character, instead of centering
  // it against the whole wrapped block and stranding it out to the left.
  const nameLine = (size: string) => (
    <>
      <Github className={cn("mr-2 inline align-middle", size)} />
      {owner ? <span className="text-muted-foreground">{owner}/</span> : null}
      <span className="font-medium">{name}</span>
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-1/2 max-w-24">{avatar}</div>
        {/* The grid's card-label treatment (column.tsx, column-preview.tsx),
            not a bespoke one — a mixed grid should read as one system. Two
            lines are reserved so a name that wraps doesn't push its avatar up
            relative to the card beside it. */}
        <span className="line-clamp-2 min-h-14 max-w-full break-words text-heading">
          {nameLine("size-4")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 p-6 text-center">
      <div className="w-32">{avatar}</div>
      <h2 className="text-heading break-words">{nameLine("size-4")}</h2>
      {description ? (
        <p className="line-clamp-6 max-w-prose break-words text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {language ? (
        <Badge variant="secondary" className="font-mono">
          {language}
        </Badge>
      ) : null}
      <Button asChild variant="link" size="sm">
        <a href={url} target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>
      </Button>
    </div>
  );
}
