import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  alternates: { canonical: "/account" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function AccountLayout({ children }) {
  return children;
}
