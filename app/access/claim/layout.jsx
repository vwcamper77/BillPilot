import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  alternates: { canonical: "/access/claim" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function AccessClaimLayout({ children }) {
  return children;
}
