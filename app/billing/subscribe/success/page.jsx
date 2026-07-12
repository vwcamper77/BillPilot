import Link from "next/link";
export default function SubscriptionSuccessPage() { return <main className="account-shell"><section className="account-panel"><h1>Your trial is being activated</h1><p>Stripe’s verified billing update activates access. This page alone does not grant access.</p><Link className="primary-button" href="/dashboard">Open ClearTill</Link><Link className="secondary-button" href="/account">Manage account</Link></section></main>; }

