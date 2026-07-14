"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics/track";
import { getGaClientId, trackGa4Event } from "@/lib/analytics/ga4";
import { getStoredAttributionBundle } from "@/lib/analytics/attribution";

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

    trackGa4Event("payment_button_click", {
      event_category: "billing",
      event_label: "founding_member_checkout",
    });

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gaClientId: getGaClientId(), attribution: getStoredAttributionBundle() }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not start checkout right now.");
      }

      trackEvent("checkout_started");
      trackGa4Event("begin_checkout", {
        currency: "GBP", value: 5,
        ...(payload.coupon ? { coupon: payload.coupon } : {}),
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
        {status.busy ? "Opening secure checkout..." : "Pay £5 securely with Stripe"}
      </button>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">
          {status.error}
        </p>
      ) : null}
    </div>
  );
}
