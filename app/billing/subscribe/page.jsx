import Link from "next/link";
import StartTrialButton from "./StartTrialButton";

export default function SubscribePage() {
  return <main className="account-shell"><section className="account-panel"><p className="account-section-label">ClearTill Monthly</p><h1>Keep your ClearTill position live</h1><p>£3.99 per month, billed immediately and then monthly until cancelled.</p><p className="helper-text">Stripe securely collects your payment method. There is no Stripe trial period.</p><StartTrialButton plan="monthly" /><Link className="secondary-button" href="/pricing">Compare plans</Link></section></main>;
}
