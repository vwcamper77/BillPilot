import Link from "next/link";

export const metadata = {
  title: "Terms of Service | ClearTill",
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ClearTill</p>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Terms of Service</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      <section className="legal-panel">
        <p>
          ClearTill is a personal cashflow planning tool designed to help you understand your upcoming bills, payday timing, savings and day-to-day spending room.
        </p>
        <p>
          ClearTill does not provide financial advice, debt advice, tax advice or regulated banking services.
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
        <p className="helper-text">Last updated: 29 June 2026</p>
      </section>
    </main>
  );
}
