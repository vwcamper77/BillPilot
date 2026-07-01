import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";

export const metadata = {
  title: "Privacy Policy | ClearTill",
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Privacy Policy</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>

      <TrustShield className="page-trust-banner" />

      <section className="legal-panel">
        <p>
          ClearTill helps you plan your money without connecting to your bank.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Who operates ClearTill</h2>
        <p>
          ClearTill is operated by GMBF Ventures Ltd, a company registered in England and Wales under company number
          {" "}17286832. Our registered office is 124 City Road, London, EC1V 2NX, United Kingdom.
        </p>

        <h2 className="account-heading">What data you enter</h2>
        <p>Information we may store includes:</p>
        <ul className="page-list">
          <li>your email address</li>
          <li>payday settings</li>
          <li>current available money entered by you</li>
          <li>bills and scheduled payments</li>
          <li>savings and big cost entries</li>
          <li>text extracted from screenshots or statements you choose to upload</li>
        </ul>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Why ClearTill uses it</h2>
        <p>
          We use this information only to provide the ClearTill service — to show
          what is due before payday and what may be left afterwards. We do not
          sell your personal data.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>No bank login, no Open Banking</h2>
        <p>
          ClearTill does not ask for your bank login details and does not use
          Open Banking. You choose what information to enter, and you can use a
          manual balance snapshot instead of connecting any account.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>How imported data is handled</h2>
        <p>
          Sensitive import data is encrypted where supported. Server-processed
          import text — such as content extracted from uploaded screenshots, CSV
          files or imported statements — is encrypted before storage using keys
          held only on the server. See our <Link href="/security">Security</Link> page
          for more detail.
        </p>
        <p>
          Some budgeting fields, such as amounts and dates, may be stored in a
          readable format so ClearTill can calculate your forecast and spending
          room in realtime. Server-processed import text is encrypted where
          supported.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Your data controls</h2>
        <p>
          You can export, reset or delete your ClearTill data from your account
          menu, and you can also delete your account. Reset and delete actions
          permanently remove your ClearTill budgeting data and cannot be undone.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Contact</h2>
        <p>
          For privacy or support questions, contact us at{" "}
          <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>.
        </p>

        <p className="helper-text" style={{ marginTop: "16px" }}>Last updated: 30 June 2026</p>
      </section>
    </main>
  );
}
