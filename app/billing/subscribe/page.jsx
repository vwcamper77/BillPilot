import Link from "next/link";
import { notFound } from "next/navigation";
import StartTrialButton from "./StartTrialButton";
import { isSubscriptionTrialEnabled } from "@/lib/subscriptionFlags";

export default function SubscribePage() {
  if (!isSubscriptionTrialEnabled()) notFound();
  return <main className="account-shell"><section className="account-panel"><p className="account-section-label">ClearTill Monthly</p><h1>Try ClearTill free for 7 days</h1><p>£0 today, then £1.99/month. Cancel anytime.</p><p className="helper-text">Stripe securely collects your payment method. Your first £1.99 monthly payment is due after the seven-day trial unless you cancel first.</p><StartTrialButton /><Link className="secondary-button" href="/dashboard">Back to dashboard</Link></section></main>;
}

