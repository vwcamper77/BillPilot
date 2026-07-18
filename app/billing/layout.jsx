import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function BillingLayout({ children }) {
  return children;
}
