import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Email operations | ClearTill admin",
  alternates: { canonical: "/admin/email-operations" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function EmailOperationsLayout({ children }) {
  return children;
}
