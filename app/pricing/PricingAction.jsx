"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady } from "@/lib/firebase";
import { getStoredAttributionBundle } from "@/lib/analytics/attribution";
import { getGaClientId } from "@/lib/analytics/ga4";
import { trackEvent } from "@/lib/analytics/track";

export default function PricingAction({ plan, configured = true }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let unsubscribe = () => undefined;
    authPersistenceReady.finally(() => {
      if (!auth) {
        setReady(true);
        return;
      }
      unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser && !nextUser.isAnonymous ? nextUser : null);
        setReady(true);
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (plan !== "free") trackEvent("upgrade_offer_viewed", { plan });
  }, [plan]);

  async function continueAction() {
    if (!ready || busy) return;
    if (!user) {
      window.location.assign("/start");
      return;
    }
    if (plan === "free") {
      window.location.assign("/dashboard");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const accessResponse = await fetch("/api/access", { headers: { Authorization: `Bearer ${token}` } });
      const accessPayload = await accessResponse.json().catch(() => ({}));
      const entitlement = accessPayload?.entitlement || {};

      if (entitlement.hasAccess && entitlement.accessType !== "no_card_preview") {
        if (!entitlement.canManageBilling) {
          setError("Your ClearTill access is already active.");
          return;
        }
        const portalResponse = await fetch("/api/stripe/portal", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const portal = await portalResponse.json().catch(() => ({}));
        if (!portalResponse.ok || !portal?.url) throw new Error(portal?.error || "Could not open subscription management.");
        window.location.assign(portal.url);
        return;
      }

      if (entitlement.canStartPreview) {
        window.location.assign("/dashboard?mode=onboarding&step=balance");
        return;
      }

      const response = await fetch("/api/stripe/subscription-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan, attribution: getStoredAttributionBundle(), gaClientId: getGaClientId() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) throw new Error(payload?.error || "Could not start secure checkout.");
      trackEvent("upgrade_checkout_started", { plan });
      window.location.assign(payload.url);
    } catch (failure) {
      setError(failure?.message || "Could not continue. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return <p className="pricing-unavailable">Annual purchase is temporarily unavailable. The monthly plan remains available.</p>;

  return (
    <div className="pricing-action">
      <button className="marketing-primary-button" type="button" onClick={continueAction} disabled={!ready || busy}>
        {busy ? "Opening securely…" : plan === "free" ? "Check my position free" : plan === "annual" ? "Choose annual" : "Choose monthly"}
      </button>
      {error ? <p className="auth-inline-message auth-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
