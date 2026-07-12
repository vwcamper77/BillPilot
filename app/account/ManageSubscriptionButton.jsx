"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

export default function ManageSubscriptionButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch("/api/stripe/portal", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not open subscription management.");
      window.location.assign(payload.url);
    } catch (failure) {
      setError(failure.message || "Could not open subscription management.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="secondary-button" type="button" onClick={openPortal} disabled={busy}>
        {busy ? "Opening…" : "Manage subscription"}
      </button>
      {error ? <p className="helper-text" role="alert">{error}</p> : null}
    </div>
  );
}

