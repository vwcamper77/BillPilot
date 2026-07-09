import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import BillingAccessGate from "./BillingAccessGate";

export const metadata = {
  title: "Billing & payments | ClearTill",
};

export default function BillingPage() {
  return (
    <main className="billing-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Billing &amp; payments</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Account</Link>
          <Link className="secondary-button" href="/">Home</Link>
        </div>
      </header>

      <TrustShield
        className="page-trust-banner"
        compact
        subtext="No bank login • No Open Banking • You control your data"
        note="Sensible privacy. Secure checkout by Stripe."
      />

      <section className="billing-hero">
        <div className="billing-panel billing-panel-highlight">
          <p className="billing-kicker">FOUNDING MEMBER ACCESS</p>
          <h2>Will your money reach payday?</h2>
          <p className="billing-lead">
            ClearTill shows your real money runway before payday &mdash; what bills are still to
            land, what big costs are coming, and what is actually safe to spend.
          </p>
          <p className="billing-founder-message">
            Become a founding member today and get 3 months&apos; early access for &pound;5.
          </p>
          <ul className="billing-feature-list">
            <li>No bank login</li>
            <li>No Open Banking</li>
            <li>No judgement</li>
          </ul>
          <BillingAccessGate />
        </div>

        <aside className="billing-panel billing-summary-panel billing-offer-panel" aria-label="Offer summary">
          <p className="billing-summary-label">Founding Member Access</p>
          <div className="billing-price-row">
            <strong>&pound;5</strong>
            <span>one-off founding member payment</span>
          </div>
          <ul className="billing-offer-list">
            <li>3 months early access</li>
            <li>See if your money will reach payday</li>
            <li>Bills still to land</li>
            <li>Big costs coming up</li>
            <li>Safe-to-spend daily figure</li>
            <li>Help shape ClearTill</li>
          </ul>
          <p className="billing-renewal-note">
            After 3 months, you can choose to continue for &pound;3.99/month or &pound;27/year.
            No automatic renewal unless you choose it later.
          </p>
        </aside>
      </section>

      <section className="billing-panel billing-next-panel">
        <p className="billing-summary-label">What happens next</p>
        <div className="billing-steps">
          <article>
            <span>01</span>
            <h3>Save your access</h3>
            <p>Create your ClearTill login here so your founding member access stays with you.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Complete secure checkout</h3>
            <p>Pay through Stripe to activate your &pound;5 founding member access.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Get early access</h3>
            <p>Open ClearTill and start using your 3 months of early access straight away.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
