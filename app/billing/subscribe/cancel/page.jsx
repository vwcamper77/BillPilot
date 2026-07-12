import Link from "next/link";
export default function SubscriptionCancelPage() { return <main className="account-shell"><section className="account-panel"><h1>No trial was started</h1><p>You have not been charged. You can return when you are ready.</p><Link className="primary-button" href="/billing/subscribe">Return to trial offer</Link><Link className="secondary-button" href="/dashboard">Back to dashboard</Link></section></main>; }

