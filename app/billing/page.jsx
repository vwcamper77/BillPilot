import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";

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

      <TrustShield className="page-trust-banner" compact />

      <section className="legal-panel">
        <h2>Billing and subscription management</h2>
        <p>Your verified access status and any relevant subscription action appear on your dashboard and account page.</p>
        <p>Stripe securely handles payment methods, invoices, and cancellation for subscription customers.</p>
        <ul className="page-list">
          <li>view payment history</li>
          <li>manage your subscription</li>
          <li>update payment method</li>
          <li>cancel your plan</li>
        </ul>
        <p className="helper-text">
          Return to your dashboard to view your ClearTill result and current access status.
        </p>
      </section>
    </main>
  );
}
