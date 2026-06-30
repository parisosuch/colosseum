import Link from "next/link";

// The "Colosseum" wordmark that opens every breadcrumb header. Single source
// so the brand name can't drift (or get misspelled) across pages.
export default function BrandLink() {
  return (
    <Link href="/" className="link-subtle">
      Colosseum
    </Link>
  );
}
