"use client";

import { useState } from "react";

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-LPD2MV2ZH9";

export default function Ga4BrowserDiagnostic({ user }) {
  const [status, setStatus] = useState({ busy: false, message: "", error: "" });

  async function runDiagnostic() {
    setStatus({ busy: true, message: "", error: "" });
    try {
      if (typeof window.gtag !== "function") throw new Error("The Google tag is not available in this browser.");
      const [clientId, sessionId] = await Promise.all([
        getGtagValue("client_id"),
        getGtagValue("session_id"),
      ]);
      console.info("[ga4-browser-test] identifiers", {
        clientIdPresent: Boolean(clientId),
        sessionIdPresent: Boolean(sessionId),
      });
      if (!clientId || !sessionId) throw new Error("GA4 did not return a browser client ID and session ID.");

      window.gtag("event", "qa_browser_test", {
        debug_mode: true,
        engagement_time_msec: 1,
        session_id: Number(sessionId),
      });

      const idToken = await user.getIdToken();
      const response = await fetch("/api/analytics/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clientId: String(clientId), sessionId: String(sessionId) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "The server diagnostic failed.");
      setStatus({
        busy: false,
        error: "",
        message: `Browser event sent; server collect ${payload.collectStatus}, validation ${payload.validationStatus}.`,
      });
    } catch (error) {
      setStatus({ busy: false, message: "", error: error?.message || "Could not run the GA4 diagnostic." });
    }
  }

  return (
    <div className="admin-section">
      <h2>GA4 browser diagnostic</h2>
      <p className="admin-section-subtitle">Temporarily sends browser-linked debug events without exposing identifier values.</p>
      <button className="secondary-button" type="button" onClick={runDiagnostic} disabled={status.busy}>
        {status.busy ? "Sending debug events…" : "Send browser-linked debug events"}
      </button>
      {status.message ? <p className="helper-text billing-success" aria-live="polite">{status.message}</p> : null}
      {status.error ? <p className="helper-text billing-error" aria-live="polite">{status.error}</p> : null}
    </div>
  );
}

function getGtagValue(fieldName) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(`Timed out reading GA4 ${fieldName}.`)), 5000);
    window.gtag("get", MEASUREMENT_ID, fieldName, (value) => {
      window.clearTimeout(timeoutId);
      resolve(value || null);
    });
  });
}
