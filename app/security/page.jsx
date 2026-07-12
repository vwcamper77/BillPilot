import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "ClearTill Security",
  alternates: { canonical: "/security" },
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
          ClearTill helps you plan your money without connecting to your bank.
        </p>
        <div className="trust-pill-row trust-pill-row-spaced" aria-label="ClearTill trust">
          <span className="trust-pill">No bank login</span>
          <span className="trust-pill">No Open Banking</span>
          <span className="trust-pill">You control your data</span>
          <span className="trust-pill trust-pill-wide">Sensitive import data encrypted where supported</span>
        </div>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>How ClearTill handles imported data</h2>
        <p>
          Server-processed import text, such as CSV, AI and uploaded-document
          extracted content, is encrypted before storage where supported.
        </p>
        <p>
          Some budgeting fields, like amounts and dates, may stay in a readable
          format so ClearTill can keep your forecast up to date. Imported text
          processed on the server is still encrypted before storage.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Your controls</h2>
        <p>
          From your account menu you can export a copy of your data, reset your
          ClearTill data, or delete your account. You stay in control of what is
          kept in ClearTill.
        </p>

        <h2 className="account-heading" style={{ marginTop: "20px" }}>Standards</h2>
        <p>
          ClearTill is built around ISO 27001-aligned security principles, but is
          not currently ISO 27001 certified.
        </p>

        <p className="helper-text" style={{ marginTop: "16px" }}>
          For the full privacy summary, see our <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <p className="legal-company-note">ClearTill is operated by GMBF Ventures Ltd.</p>
      </section>
    </main>
  );
}
