import { Breadcrumb, type Crumb } from "@/components/breadcrumb";

export type { Crumb } from "@/components/breadcrumb";

// The header that opens every page: the breadcrumb trail of parents over the
// page title. Pass the crumbs in order and leave `href` off the last one, which
// is the page itself. Single source so the header can't drift per page.
export default function PageHeader({ crumbs }: { crumbs: Crumb[] }) {
  return <Breadcrumb crumbs={crumbs} />;
}
