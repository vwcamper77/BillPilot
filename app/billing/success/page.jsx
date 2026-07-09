import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import FoundingFeedbackForm from "./FoundingFeedbackForm";
import RepairAccessButton from "./RepairAccessButton";
import { grantFoundingAccessFromCheckoutSessionId } from "@/lib/billingAccess.server";
import { formatBillingExpiry } from "@/lib/billingAccess";
import { getFirebaseProjectId } from "@/lib/firebaseAdmin";

export const metadata = {
  title: "Payment received | ClearTill",
};

export default async function BillingSuccessPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const sessionId = String(resolvedSearchParams?.session_id || "").trim();
  let accessMessage = "";
  let accessError = "";

  if (sessionId) {
    try {
      const billingRecord = await grantFoundingAccessFromCheckoutSessionId(sessionId);
      accessMessage = `Access is live through ${formatBillingExpiry(billingRecord)}.`;
    } catch (error) {
      // The underlying SDK error (Stripe/Firestore/Auth) is for logs only —
      // never surface raw error text to the user.
      console.error("Failed to grant founding access from checkout session", {
        stripeSessionId: sessionId,
        uid: error?.context?.uid || null,
        email: error?.context?.email || null,
        paymentStatus: error?.context?.paymentStatus || null,
        firebaseProjectId: error?.context?.firebaseProjectId || getFirebaseProjectId(),
        attemptedUserDocPath: error?.context?.attemptedUserDocPath || "",
        attemptedBillingDocPath: error?.context?.attemptedBillingDocPath || "",
      }, error);
      accessError = "Payment received, but we could not activate your access automatically. Please contact hello@cleartill.money.";
    }
  } else {
    console.error("Billing success page loaded without a checkout session id.");
    accessError = "We couldn't confirm this checkout automatically. Get in touch and we'll unlock your access directly.";
  }

  return (
    <main className="billing-shell billing-shell-success">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand billing-success-eyebrow">Payment received</h1>
        </div>
      </header>

      <section className="billing-panel billing-status-panel">
        <p className="billing-status-kicker">Founding member confirmed</p>
        <h2 className="billing-status-headline">You&apos;re in — thank you for becoming a ClearTill founding member.</h2>
        <p className="billing-status-copy">
          You now have 3 months of early access. I&apos;m building ClearTill with real
          feedback from people who want a clearer answer to one question:
        </p>
        <p className="billing-success-question">Will my money last until payday?</p>
        <p className="billing-status-copy">Your feedback will directly shape what gets built next.</p>
        {accessMessage ? <p className="helper-text billing-success">{accessMessage}</p> : null}
        {accessError ? <p className="helper-text billing-error">{accessError}</p> : null}
        {accessError && sessionId ? <RepairAccessButton sessionId={sessionId} /> : null}
      </section>

      <TrustShield className="page-trust-banner billing-trust-banner" compact />

      <section className="billing-panel billing-feedback-panel">
        <FoundingFeedbackForm />
      </section>

      <div className="billing-success-actions">
        <Link className="primary-link billing-success-primary" href="/dashboard">Go to dashboard</Link>
        <Link className="quiet-link billing-success-account" href="/account">Account</Link>
      </div>
    </main>
  );
}
