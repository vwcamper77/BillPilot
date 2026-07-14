"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The success page is display-only. Account association requires the signed
 * access link; neither this component nor a checkout redirect can grant it.
 */
export default function AccessStatus({ sessionId, maskedEmail }) {
  const [resend, setResend] = useState({ busy: false, sent: false, error: "" });

  async function handleResend() {
    setResend({ busy: true, sent: false, error: "" });

    try {
      const response = await fetch("/api/access/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "We could not resend your access link.");
      }

      setResend({ busy: false, sent: true, error: "" });
    } catch (error) {
      setResend({ busy: false, sent: false, error: error?.message || "We could not resend your access link." });
    }
  }

  return (
    <div className="billing-access-block">
      <p className="billing-status-copy">
        We&apos;ve sent a secure access link to {maskedEmail || "the email used at checkout"}.
      </p>
      <p className="helper-text">Follow the link in that email to sign in and start using ClearTill.</p>
      <div className="billing-cta-stack">
        <button className="secondary-button" type="button" onClick={handleResend} disabled={resend.busy}>
          {resend.busy ? "Resending..." : "Resend access link"}
        </button>
        <Link className="quiet-link" href="/dashboard">I already have an account</Link>
      </div>
      {resend.sent ? <p className="helper-text billing-success" aria-live="polite">Access link sent.</p> : null}
      {resend.error ? <p className="helper-text billing-error" aria-live="polite">{resend.error}</p> : null}
      <p className="helper-text">Need help? Contact hello@cleartill.money.</p>
    </div>
  );
}
