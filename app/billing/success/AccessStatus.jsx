"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { auth, authPersistenceReady } from "@/lib/firebase";
import { trackGa4Event } from "@/lib/analytics/ga4";

function getRestoredUser() {
  return new Promise((resolve) => {
    if (!auth) {
      resolve(null);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * If the visitor already has a real (non-anonymous) Firebase session whose
 * email matches the checkout email, claims access immediately without
 * requiring the emailed link — see /api/access/claim's session-only path.
 * Otherwise shows the "check your email" state with a resend affordance.
 */
export default function AccessStatus({ sessionId, maskedEmail }) {
  const [state, setState] = useState("checking"); // checking | awaiting-email | claimed
  const [resend, setResend] = useState({ busy: false, sent: false, error: "" });

  useEffect(() => {
    let cancelled = false;

    async function tryImmediateClaim() {
      try {
        await authPersistenceReady;
        const user = await getRestoredUser();

        if (!user || user.isAnonymous || cancelled) {
          if (!cancelled) setState("awaiting-email");
          return;
        }

        const idToken = await user.getIdToken();
        const response = await fetch("/api/access/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ sessionId }),
        });

        if (cancelled) return;

        if (response.ok) {
          setState("claimed");
        } else {
          setState("awaiting-email");
        }
      } catch {
        if (!cancelled) setState("awaiting-email");
      }
    }

    tryImmediateClaim();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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

  if (state === "checking") {
    return <p className="helper-text">Checking your access...</p>;
  }

  if (state === "claimed") {
    return (
      <div className="billing-access-block">
        <p className="helper-text billing-success">Your ClearTill access is active.</p>
        <Link className="primary-link billing-success-primary" href="/dashboard" onClick={() => trackGa4Event("dashboard_entered")}>
          Go to dashboard
        </Link>
      </div>
    );
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
