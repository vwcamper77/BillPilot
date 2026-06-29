import Link from "next/link";

export const metadata = {
  title: "Billing & payments | ClearTill",
};

export default function BillingPage() {
  return (
    <main className="billing-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ClearTill</p>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Billing &amp; payments</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

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
