"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { getStoredAttributionBundle } from "@/lib/analytics/attribution";
import { getGaClientId } from "@/lib/analytics/ga4";

export default function StartTrialButton() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true); setError("");
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sign in from the dashboard before starting your trial.");
      const response = await fetch("/api/stripe/subscription-checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ attribution: getStoredAttributionBundle(), gaClientId: getGaClientId() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not start checkout.");
      window.location.assign(payload.url);
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <div><button className="primary-button" type="button" onClick={start} disabled={busy}>{busy ? "Opening secure checkout…" : "Start my free 7-day trial"}</button>{error ? <p className="helper-text" role="alert">{error}</p> : null}</div>;
}
