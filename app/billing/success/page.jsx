import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import FoundingFeedbackForm from "./FoundingFeedbackForm";
import RememberCheckoutSession from "./RememberCheckoutSession";
import DashboardLink from "./DashboardLink";
import AccessStatus from "./AccessStatus";
import {
  getPendingEntitlementBySessionId,
} from "@/lib/entitlements.server";
import { getFirebaseProjectId } from "@/lib/firebaseAdmin";
import { isPublicCheckoutEnabled } from "@/lib/checkoutFlags";

export const metadata = {
  title: "Payment received | ClearTill",
  alternates: { canonical: "/billing/success" },
};

export default async function BillingSuccessPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const sessionId = String(resolvedSearchParams?.session_id || "").trim();

  return isPublicCheckoutEnabled()
    ? renderPublicFlow(sessionId)
    : renderLegacyFlow(sessionId);
}

async function renderLegacyFlow(sessionId) {
  let accessMessage = "Payment confirmation is pending. Refresh shortly; no purchase is recorded by this page.";
  let accessError = "";
  let confirmed = false;

  if (sessionId) {
    try {
      const entitlement = await getPendingEntitlementBySessionId(sessionId);
      if (entitlement) {
        confirmed = true;
        accessMessage = "Payment confirmed by Stripe. Your access is ready.";
      }
    } catch (error) {
      // The underlying SDK error (Stripe/Firestore/Auth) is for logs only —
      // never surface raw error text to the user.
      console.error("Failed to read founding entitlement for checkout session", {
        stripeSessionId: sessionId,
        uid: error?.context?.uid || null,
        email: error?.context?.email || null,
        paymentStatus: error?.context?.paymentStatus || null,
        firebaseProjectId: error?.context?.firebaseProjectId || getFirebaseProjectId(),
        attemptedUserDocPath: error?.context?.attemptedUserDocPath || "",
        attemptedBillingDocPath: error?.context?.attemptedBillingDocPath || "",
      }, error);
      accessError = "We could not read the verified payment status. Please retry shortly or contact support.";
    }
  } else {
    console.error("Billing success page loaded without a checkout session id.");
    accessError = "We couldn't confirm this checkout automatically. Get in touch and we'll unlock your access directly.";
  }

  return (
    <SuccessShell sessionId={sessionId}>
      <section className="billing-panel billing-status-panel">
        <p className="billing-status-kicker">Payment status</p>
        <h2 className="billing-status-headline">{confirmed ? "Confirmed — your founding access is ready" : accessError ? "Recovery required" : "Confirmation pending"}</h2>
        <p className="billing-status-copy">
          {confirmed ? "Your verified payment includes 90 days of early access." : "No access or purchase is created until the signed Stripe webhook confirms payment."}
        </p>
        <p className="billing-success-question">Will my money last until I'm paid?</p>
        <p className="billing-status-copy">Your feedback will directly shape what gets built next.</p>
        {accessMessage ? <p className="helper-text billing-success">{accessMessage}</p> : null}
        {accessError ? <p className="helper-text billing-error">{accessError}</p> : null}
      </section>

      <TrustShield className="page-trust-banner billing-trust-banner" compact />

      <section className="billing-panel billing-feedback-panel">
        <FoundingFeedbackForm />
      </section>

      <div className="billing-success-actions">
        <DashboardLink />
        <Link className="quiet-link billing-success-account" href="/account">Account</Link>
      </div>
    </SuccessShell>
  );
}

async function renderPublicFlow(sessionId) {
  let maskedEmail = "";
  let accessError = "";

  if (sessionId) {
    try {
      const entitlement = await getPendingEntitlementBySessionId(sessionId);
      if (!entitlement) throw Object.assign(new Error("Pending webhook verification"), { code: "pending" });
      maskedEmail = entitlement?.maskedEmail || "";
    } catch (error) {
      console.error("Failed to read checkout entitlement on the success page", {
        stripeSessionId: sessionId,
        firebaseProjectId: error?.context?.firebaseProjectId || getFirebaseProjectId(),
      }, error);
      accessError = error?.code === "pending"
        ? "Stripe confirmation is still pending. Refresh shortly; this page cannot create a purchase or grant access."
        : "We could not read the verified payment status. Please contact hello@cleartill.money.";
    }
  } else {
    console.error("Billing success page loaded without a checkout session id.");
    accessError = "We couldn't confirm this checkout automatically. Get in touch and we'll unlock your access directly.";
  }

  return (
    <SuccessShell sessionId={sessionId}>
      <section className="billing-panel billing-status-panel">
        <p className="billing-status-kicker">Payment status</p>
        <h2 className="billing-status-headline">{accessError ? "Confirmation pending" : "Payment confirmed — your ClearTill access is ready"}</h2>
        {accessError ? (
          <p className="helper-text billing-error">{accessError}</p>
        ) : (
          <AccessStatus sessionId={sessionId} maskedEmail={maskedEmail} />
        )}
      </section>

      <TrustShield className="page-trust-banner billing-trust-banner" compact />

      <section className="billing-panel billing-feedback-panel">
        <FoundingFeedbackForm />
      </section>

      <div className="billing-success-actions">
        <Link className="quiet-link billing-success-account" href="mailto:hello@cleartill.money">Contact support</Link>
      </div>
    </SuccessShell>
  );
}

function SuccessShell({ sessionId, children }) {
  return (
    <main className="billing-shell billing-shell-success">
      {sessionId ? <RememberCheckoutSession sessionId={sessionId} /> : null}
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand billing-success-eyebrow">Payment status</h1>
        </div>
      </header>
      {children}
    </main>
  );
}
