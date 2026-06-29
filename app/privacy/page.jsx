import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | ClearTill",
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ClearTill</p>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Privacy Policy</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      <section className="legal-panel">
        <p>
          ClearTill is designed to help users manage payday cashflow, bills, savings and planned costs.
        </p>
        <p>Information we may store includes:</p>
        <ul className="page-list">
          <li>your email address</li>
          <li>payday settings</li>
          <li>current balance entered by you</li>
          <li>bills and scheduled payments</li>
          <li>savings and big cost entries</li>
          <li>imported statement data, if you choose to upload it in future</li>
        </ul>
        <p>
          We use this information only to provide the ClearTill service.
        </p>
        <p>
          We do not sell your personal data.
        </p>
        <p>
          If bank statement import is added, uploaded data may contain sensitive financial information. ClearTill should only store the data required to identify bills, recurring payments and cashflow insights.
        </p>
        <p>
          You can reset or delete your ClearTill data from your account menu.
        </p>
        <p>
          You can also delete your account.
        </p>
        <p className="helper-text">Last updated: 29 June 2026</p>
      </section>
    </main>
  );
}
