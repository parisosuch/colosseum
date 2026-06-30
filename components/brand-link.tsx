import Link from "next/link";

// The "Colosseum" wordmark that opens every breadcrumb header. Single source
// so the brand name can't drift (or get misspelled) across pages.
export default function BrandLink() {
  return (
    <Link
      href="/"
      className="underline dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
    >
      Colosseum
    </Link>
  );
}
