import Link from "next/link";
import Logo from "@/components/Logo";

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
            <div className="home-trust-stack" aria-label="ClearTill trust">
              <span className="trust-pill">No bank login</span>
              <span className="trust-pill">No Open Banking</span>
              <span className="trust-pill">You control your data</span>
              <span className="trust-pill trust-pill-wide">Sensitive import data encrypted where supported</span>
            </div>
            <p className="helper-text home-hero-support">
              ClearTill helps you plan your money without connecting to your bank.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
