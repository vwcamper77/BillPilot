import Link from "next/link";
import Logo from "@/components/Logo";

export default function MarketingHeader() {
  return (
    <header className="live-home-container live-home-header">
      <Link href="/" aria-label="ClearTill home">
        <Logo className="live-home-logo" height={42} />
      </Link>
      <nav className="live-home-nav" aria-label="Main navigation">
        <Link href="/pricing">Pricing</Link>
        <Link href="/about-cleartill">About</Link>
        <Link className="live-home-signin" href="/signin">Sign in</Link>
      </nav>
    </header>
  );
}
