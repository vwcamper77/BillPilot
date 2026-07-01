import Link from "next/link";
import Logo from "@/components/Logo";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <div className="home-hero">
          <div className="home-hero-copy">
            <Logo className="home-brand-logo" height={68} />
            <h1>Know you&apos;re clear till payday.</h1>
            <p className="home-hero-copy-text">
              ClearTill is a payday-aware bill forecast that helps you see what
              is due before you get paid, without connecting your bank.
            </p>
            <p className="home-hero-detail">
              Add your current available money, your payday, and your monthly
              bills. ClearTill then shows whether you&apos;re clear till payday
              and what still needs covering before then.
            </p>
            <div className="home-trust-stack" aria-label="ClearTill trust">
              <span className="trust-pill">No bank login</span>
              <span className="trust-pill">No Open Banking</span>
              <span className="trust-pill">You control your data</span>
            </div>
            <p className="helper-text home-hero-support">
              Plan ahead without connecting your bank, categorising spend, or
              handing over account access.
            </p>
            <div className="home-cta-row">
              <Link className="primary-link" href="/dashboard">
                Get started
              </Link>
              <Link className="secondary-button" href="/dashboard">
                Sign in with Google or email
              </Link>
            </div>
          </div>
          <div className="home-feature-panel" aria-label="What ClearTill does">
            <div className="home-feature-card">
              <p className="eyebrow">What ClearTill does</p>
              <h2>One calm view of what is due before payday.</h2>
              <p>
                ClearTill is built for people who want a simple answer to one
                question: am I clear till payday?
              </p>
            </div>
            <div className="home-feature-grid">
              <article className="home-feature-item">
                <h3>Add the essentials</h3>
                <p>Current available money, monthly bills, and your payday.</p>
              </article>
              <article className="home-feature-item">
                <h3>See what is coming</h3>
                <p>Get a clear heads-up on bills due before your next pay date.</p>
              </article>
              <article className="home-feature-item">
                <h3>Stay in control</h3>
                <p>No bank login, no Open Banking, and no hidden syncing.</p>
              </article>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
