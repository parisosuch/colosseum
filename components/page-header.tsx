import Link from "next/link";

import BrandLink from "@/components/brand-link";

export type Crumb = { label: string; href?: string };

// The breadcrumb header that opens every page: "Colosseum / handle / channel".
// A crumb with an href renders as a subtle link; the last (current) crumb is
// usually passed without one. Single source so the header can't drift per page.
export default function PageHeader({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <h1 className="text-display">
      <BrandLink />
      {crumbs.map((crumb, i) => (
        <span key={i}>
          {" "}
          <span className="font-extralight">/</span>{" "}
          {crumb.href ? (
            <Link href={crumb.href} className="link-subtle">
              {crumb.label}
            </Link>
          ) : (
            crumb.label
          )}
        </span>
      ))}
    </h1>
  );
}
