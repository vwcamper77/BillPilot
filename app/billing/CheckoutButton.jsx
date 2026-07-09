"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

export default function CheckoutButton() {
  const [status, setStatus] = useState({ busy: false, error: "" });

  async function handleCheckout() {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) {
      setStatus({
        busy: false,
        error: "Sign in with a full account before starting payment.",
      });
      return;
    }

    setStatus({ busy: true, error: "" });

    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "payment_button_click", {
        event_category: "billing",
        event_label: "founding_member_checkout",
        value: 5,
        currency: "GBP",
      });
    }

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not start checkout right now.");
      }

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
        {status.busy ? "Redirecting to Stripe..." : "Become a Founding Member \u2014 \u00A35"}
      </button>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">
          {status.error}
        </p>
      ) : null}
    </div>
  );
}
