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
        <h2>Start your 7-day free trial</h2>
        <p>£0 today. After 7 days, ClearTill bills £1.99, then continues monthly unless you cancel.</p>
        <p>After you choose the plan from your dashboard, this area is where you manage billing safely in Stripe.</p>
        <ul className="page-list">
          <li>view payment history</li>
          <li>manage your subscription</li>
          <li>update payment method</li>
          <li>cancel your plan</li>
        </ul>
        <p className="helper-text">
          Start from your dashboard after you&apos;ve seen your first personalised result and are ready to begin the free trial.
        </p>
      </section>
    </main>
  );
}
