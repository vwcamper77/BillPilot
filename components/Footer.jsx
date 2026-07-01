import Link from "next/link";
import Logo from "@/components/Logo";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <Link href="/" aria-label="ClearTill home">
          <Logo className="site-footer-logo" height={32} />
        </Link>
        <p className="site-footer-company">ClearTill is a product from GMBF Ventures Ltd.</p>
        <p className="site-footer-company-detail">
          GMBF Ventures Ltd - Company No. 17286832 - Registered office: 124 City Road, London, EC1V 2NX, United Kingdom
        </p>
        <span className="site-footer-meta">&copy; 2026 ClearTill</span>
      </div>
      <div className="site-footer-links">
        <Link href="/privacy">Privacy</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/terms">Terms</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/security">Security</Link>
        <span aria-hidden="true">&middot;</span>
        <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>
      </div>
    </footer>
  );
}
