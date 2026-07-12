import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Terms of Service | ClearTill",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Terms of Service</h1>
          <div className="terms-trust-row" aria-label="ClearTill trust">
            <span className="trust-pill">No bank login</span>
            <span className="trust-pill">No Open Banking</span>
            <span className="trust-pill">You control your data</span>
          </div>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>
      <section className="legal-panel">
        <h2 className="account-heading">Who we are</h2>
        <p>
          ClearTill is a product from GMBF Ventures Ltd, a company registered in England and Wales under company number
          {" "}17286832. Our registered office is 124 City Road, London, EC1V 2NX, United Kingdom.
        </p>
        <p>
          ClearTill is a personal cashflow planning tool provided by GMBF Ventures Ltd to help you understand your
          upcoming bills, when you get paid, savings and day-to-day spending room.
        </p>
        <p>
          GMBF Ventures Ltd does not provide financial advice, debt advice, tax advice or regulated banking services
          through ClearTill.
        </p>
        <p>
          You are responsible for checking that any information you enter is accurate. ClearTill calculations are estimates and should not be relied on as a guarantee of available funds.
        </p>
        <p>
          You should not use ClearTill as your only source of financial decision-making.
        </p>
        <p>
          We may update these terms as the product develops.
        </p>
        <p className="helper-text">Last updated: 1 July 2026</p>
      </section>
    </main>
  );
}
