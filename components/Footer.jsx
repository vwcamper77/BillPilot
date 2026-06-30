import Link from "next/link";
import Logo from "@/components/Logo";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <Link href="/" aria-label="ClearTill home">
          <Logo className="site-footer-logo" height={32} />
        </Link>
        <p className="site-footer-tagline">Know you&apos;re clear till payday.</p>
        <span>&copy; {year} ClearTill</span>
      </div>
      <div className="site-footer-links">
        <Link href="/terms">Terms of Service</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/privacy">Privacy Policy</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/security">Security</Link>
      </div>
    </footer>
  );
}
