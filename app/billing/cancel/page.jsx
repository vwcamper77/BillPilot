import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";

export const metadata = {
  title: "Checkout cancelled | ClearTill",
  alternates: { canonical: "/billing/cancel" },
};

export default function BillingCancelPage() {
  return (
    <main className="billing-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Checkout cancelled</h1>
        </div>
      </header>

      <TrustShield className="page-trust-banner" compact />

      <section className="billing-panel billing-status-panel">
        <p className="billing-status-kicker">No payment taken</p>
        <h2>You can come back when you are ready.</h2>
        <p>
          Your Stripe checkout was cancelled before payment completed.
        </p>
        <div className="topbar-actions">
          <Link className="primary-link" href="/billing">Try again</Link>
          <Link className="secondary-button" href="/">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
