import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShieldBadge from "@/app/components/TrustShieldBadge";

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
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      <TrustShieldBadge className="page-trust-banner" />

      <section className="legal-panel">
        <p>
          ClearTill payments and subscription management will appear here.
        </p>
        <p>Future Stripe integration will allow you to:</p>
        <ul className="page-list">
          <li>view payment history</li>
          <li>manage your subscription</li>
          <li>update payment method</li>
          <li>cancel your plan</li>
        </ul>
        <p className="helper-text">
          This is a placeholder for future billing controls.
        </p>
      </section>
    </main>
  );
}

// TODO: Connect to Stripe Customer Portal when paid plans are enabled.
