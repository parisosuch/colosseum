import Link from "next/link";

// The public end of the app's chrome. Both pages linked here are ungated —
// /changelog and /developers read from disk and never touch the session — but
// the only way to either used to be the avatar menu, which a signed-out visitor
// doesn't have. Anyone sizing up a self-hosted instance can now reach the REST
// and MCP reference without an account.
//
// Rendered at the end of the scrollable content region, not fixed: the mobile
// bottom bar is fixed and the scroll region already carries padding to clear
// it, so a footer inside that region ends above the bar instead of under it.
export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t px-4 py-6">
      <nav
        aria-label="Site"
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-caption"
      >
        <span>Colosseum</span>
        <Link href="/changelog" className="rounded-sm hover:text-foreground focus-ring">
          Changelog
        </Link>
        <Link href="/developers" className="rounded-sm hover:text-foreground focus-ring">
          Developers
        </Link>
      </nav>
    </footer>
  );
}
