"use client";

import { useEffect } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import { trackEvent } from "@/lib/analytics/track";

export default function AccessLockPanel({ shellClassName = "dashboard-shell" }) {
  useEffect(() => {
    trackEvent("paywall_viewed", { source: "access_lock" });
  }, []);

  return (
    <main className={shellClassName}>
      <section className="auth-panel">
        <Logo className="eyebrow-logo" />
        <h1>Access locked</h1>
        <p>Your founding access has ended. Continue with ClearTill for &pound;3.99/month or &pound;27/year.</p>
        <TrustShield className="auth-trust-banner" compact />
        <div className="topbar-actions">
          <Link className="primary-link" href="/billing">Renew access</Link>
          <Link className="secondary-button" href="/account">Account</Link>
        </div>
      </section>
    </main>
  );
}
