"use client";

import { useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady } from "@/lib/firebase";
import { trackGa4Event, getGaClientId } from "@/lib/analytics/ga4";
import { getStoredAttributionBundle } from "@/lib/analytics/attribution";

/** Resolves with the first restored auth user (or null), not just whatever
 * auth.currentUser happens to be synchronously right now — Firebase restores
 * a persisted session asynchronously. */
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

export default function PublicCheckoutOffer() {
  const [status, setStatus] = useState({ busy: false, error: "" });

  async function handleCheckout() {
    setStatus({ busy: true, error: "" });

    try {
      const headers = { "Content-Type": "application/json" };

      // Convenience only, never trusted server-side beyond a prefill: if a
      // real (non-anonymous) session already exists, skip re-typing email
      // into Stripe's own field.
      try {
        await authPersistenceReady;
        const user = await getRestoredUser();
        if (user && !user.isAnonymous) {
          const idToken = await user.getIdToken();
          headers.Authorization = `Bearer ${idToken}`;
        }
      } catch {
        // No signed-in session available — proceed without a prefill.
      }

      const response = await fetch("/api/stripe/public-checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({ gaClientId: getGaClientId(), attribution: getStoredAttributionBundle() }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not start checkout right now.");
      }

      trackGa4Event("begin_checkout", {
        currency: "GBP",
        value: 5,
        items: [{ item_id: "founding_member_90_day", item_name: "ClearTill 90-day founding-member offer", price: 5, quantity: 1 }],
      });

      window.location.href = payload.url;
    } catch (error) {
      setStatus({
        busy: false,
        error: error?.message || "Could not start checkout right now.",
      });
    }
  }

  return (
    <div className="billing-cta-stack">
      <button
        className="primary-button billing-primary-button"
        type="button"
        onClick={handleCheckout}
        disabled={status.busy}
      >
        {status.busy ? "Opening secure checkout..." : "Continue to secure checkout"}
      </button>
      <p className="helper-text">
        You&apos;ll enter your email during checkout. We&apos;ll send your ClearTill sign-in link there once payment is confirmed.
      </p>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">
          {status.error}
        </p>
      ) : null}
    </div>
  );
}
