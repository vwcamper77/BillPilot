import Link from "next/link";
import { createPageMetadata, HOME_URL } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "ClearTill Privacy Policy",
  description: "How ClearTill and GMBF Ventures Ltd collect, use and protect account and cashflow-planning data.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ClearTill</p>
          <h1 className="brand" style={{ fontSize: "2rem" }}>ClearTill Privacy Policy</h1>
        </div>
        <nav className="topbar-actions" aria-label="Privacy policy navigation">
          <a className="secondary-button" href={HOME_URL}>Back to ClearTill home</a>
          <Link className="secondary-button" href="/terms">Terms</Link>
        </nav>
      </header>

      <article className="legal-panel">
        <p>
          This privacy policy explains how ClearTill handles information when you create an account
          and use the ClearTill money-planning service.
        </p>

        <h2 className="account-heading">Who operates ClearTill</h2>
        <p>
          ClearTill is operated by GMBF Ventures Ltd, a company registered in England and Wales under
          company number 17286832. Its registered office is 124 City Road, London, EC1V 2NX, United Kingdom.
          Privacy questions can be sent to{" "}
          <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>.
        </p>

        <h2 className="account-heading">Account data we collect</h2>
        <p>
          When you register or sign in, ClearTill processes account information such as your email address,
          Firebase user identifier, authentication provider and, where supplied, your display name. ClearTill
          uses Firebase Authentication to create and secure user accounts and to confirm who is making an
          authenticated request.
        </p>

        <h2 className="account-heading">Financial planning data you provide</h2>
        <p>
          ClearTill stores the information you choose to enter so it can calculate your position before payday.
          This may include:
        </p>
        <ul className="page-list">
          <li>your current balance or available-money snapshot;</li>
          <li>your payday, income amount and income schedule;</li>
          <li>bills, subscriptions and other scheduled payments;</li>
          <li>large costs and their planned dates;</li>
          <li>savings balances and savings allocated to future costs; and</li>
          <li>information extracted from screenshots, CSV files or statements that you choose to upload.</li>
        </ul>
        <p>
          ClearTill uses Firebase services, including Firestore, to store user and service data. Sensitive
          server-processed import content is encrypted where supported. ClearTill does not sell your personal
          data.
        </p>

        <h2 className="account-heading">No bank login or Open Banking</h2>
        <p>
          ClearTill does not require your bank login details and does not require an Open Banking connection.
          You decide what information to enter and can use a manually entered balance instead of connecting a
          bank account.
        </p>

        <h2 className="account-heading">Payments</h2>
        <p>
          ClearTill may use Stripe to provide secure payment, subscription and billing-portal services. Stripe
          processes payment details under its own privacy terms. ClearTill does not store full payment-card
          details.
        </p>

        <h2 className="account-heading">Analytics</h2>
        <p>
          Where configured, ClearTill may use analytics and attribution tools such as Google Analytics, Google
          Tag Manager, Meta Pixel and Mixpanel to understand service usage, diagnose problems and measure
          marketing performance. Analytics is used only as described in this policy and according to the
          consent controls presented by ClearTill. ClearTill does not send the balance, payday, bills, large
          costs or savings values you enter as analytics properties.
        </p>

        <h2 className="account-heading">Service emails</h2>
        <p>
          ClearTill may send essential account, access, preview and service emails. Optional reminders can be
          managed through the available account settings or unsubscribe link.
        </p>
        <p>
          If you request a free guide or worksheet, ClearTill stores the email address and limited source
          information needed to fulfil that request and prevent duplicate delivery. The requested resource is
          sent whether or not you separately choose marketing emails. Marketing permission is optional,
          unticked by default and recorded with the wording and time of your choice.
        </p>

        <h2 className="account-heading">Exporting or deleting your data</h2>
        <p>
          Signed-in users can use the account page to export their data, reset their ClearTill planning data,
          delete their ClearTill data, or delete their account. You may also request access to or deletion of
          your information by emailing{" "}
          <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>.
        </p>

        <h2 className="account-heading">Contact and related terms</h2>
        <p>
          Read the <Link href="/terms">ClearTill Terms</Link>, return to the{" "}
          <a href={HOME_URL}>ClearTill home page</a>, or contact{" "}
          <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>.
        </p>

        <p className="helper-text" style={{ marginTop: "16px" }}>Last updated: 18 July 2026</p>
      </article>
    </main>
  );
}
