import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Dashboard",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function DashboardLayout({ children }) {
  return children;
}
