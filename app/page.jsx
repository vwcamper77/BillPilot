import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShieldBadge from "@/app/components/TrustShieldBadge";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <div className="home-hero">
          <div className="home-hero-copy">
            <Logo className="home-brand-logo" height={68} />
            <p className="helper-text">cleartill.money</p>
            <h1>Know you&apos;re clear till payday.</h1>
            <p className="home-hero-copy-text">
              Tell ClearTill your bills.
              <br />
              Tell ClearTill your payday.
              <br />
              See what&apos;s coming before you get paid.
            </p>
            <Link className="primary-link" href="/dashboard">
              Open dashboard
            </Link>
          </div>
          <div className="home-hero-shield">
            <TrustShieldBadge className="home-trust-badge" />
          </div>
        </div>
      </section>
    </main>
  );
}
