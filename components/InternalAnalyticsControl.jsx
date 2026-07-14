"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

export default function InternalAnalyticsControl() {
  const [state, setState] = useState({ loading: true, active: false, eligible: false, error: "" });

  async function request(method = "GET") {
    const user = auth?.currentUser;
    if (!user) return;
    const response = await fetch("/api/internal-analytics", {
      method,
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not update internal testing.");
    setState({ loading: false, active: Boolean(payload.active), eligible: method === "GET" ? Boolean(payload.eligible) : true, error: "" });
    if (method !== "GET") window.location.reload();
  }

  useEffect(() => { request().catch((error) => setState((value) => ({ ...value, loading: false, error: error.message }))); }, []);
  if (state.loading || !state.eligible) return null;

  async function sendDiagnostics() {
    const response = await fetch("/api/internal-analytics/test", { method: "POST", headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not send diagnostics.");
    setState((value) => ({ ...value, error: "DebugView / Meta Test Events diagnostic sent; no production conversion was sent." }));
  }

  return (
    <section className="account-panel">
      <p className="account-section-label">Internal analytics testing</p>
      <p className="helper-text">This setting applies only to this browser and expires after 30 days.</p>
      <button className="secondary-button" type="button" onClick={() => request(state.active ? "DELETE" : "POST").catch((error) => setState((value) => ({ ...value, error: error.message })))}>
        {state.active ? "Disable internal testing" : "Enable internal testing"}
      </button>
      {state.active ? <button className="secondary-button" type="button" onClick={() => sendDiagnostics().catch((error) => setState((value) => ({ ...value, error: error.message })))}>Send diagnostic test events</button> : null}
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
    </section>
  );
}
