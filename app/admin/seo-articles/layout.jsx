import Link from "next/link";
import Logo from "@/components/Logo";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";
import styles from "./operations.module.css";

export const metadata = {
  title: "SEO articles | ClearTill admin",
  alternates: { canonical: "/admin/seo-articles" },
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function SeoArticlesAdminLayout({ children }) {
  const tabs = [
    ["/admin/seo-articles", "Overview"],
    ["/admin/seo-articles/calendar", "Content calendar"],
    ["/admin/seo-articles/generate", "Content generation"],
    ["/admin/seo-articles/review", "Review queue"],
    ["/admin/seo-articles/publishing", "Publishing pipeline"],
    ["/admin/seo-articles/distribution", "Buffer distribution"],
    ["/admin/seo-articles/performance", "Performance"],
    ["/admin/seo-articles/settings", "Settings"],
  ];
  return (
    <div className={styles.adminFrame}>
      <header className={styles.adminNav}>
        <Link href="/admin/seo-articles" aria-label="ClearTill SEO overview"><Logo height={32} /></Link>
        <nav aria-label="SEO administration">
          {tabs.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
        <span>Automation off</span>
      </header>
      {children}
    </div>
  );
}
