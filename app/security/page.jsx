import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "ClearTill Security",
};

export default function SecurityPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>ClearTill Security</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/account">Back to account</Link>
          <Link className="secondary-button" href="/dashboard">Dashboard</Link>
        </div>
      </header>
      <section className="legal-panel">
        <p>
          ClearTill is built to be calm and trustworthy. Here is how we approach your data.
        </p>
        <ul className="page-list">
          <li>No bank login.</li>
          <li>No Open Banking.</li>
          <li>You choose what information to enter.</li>
          <li>Server-processed import text is encrypted before storage.</li>
          <li>Sensitive import data is encrypted where supported.</li>
          <li>You control your data — you can reset or delete it at any time.</li>
        </ul>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>How encryption works</h2>
        <p>
          ClearTill applies application-level encryption to import text processed
          on our servers, such as content extracted from uploaded screenshots,
          CSV files or imported statements. Encryption keys are held only on the
          server and are never shared with your browser.
        </p>
        <p>
          ClearTill&apos;s live dashboard budgeting fields are currently stored in a
          format that supports realtime calculations. Server-processed import
          text, such as AI/CSV/upload extracted content, is encrypted before
          storage.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Your controls</h2>
        <p>
          From your account menu you can export a copy of your data, reset your
          ClearTill data, or delete your account. These actions are recorded in a
          security log that never stores your financial values.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Standards</h2>
        <p>
          ClearTill is built around ISO 27001-aligned security principles, but is
          not currently ISO 27001 certified.
        </p>

        <p className="helper-text" style={{ marginTop: "16px" }}>
          Questions about security? See our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
