"use client";

import { useState } from "react";

const RECENT_SESSION_STORAGE_KEY = "cleartill_recent_checkout_session_id";

export default function RepairAccessButton({
  sessionId,
  idleLabel = "Repair my access",
  busyLabel = "Repairing access...",
  successMessage = "",
  onSuccess = null,
}) {
  const [status, setStatus] = useState({ busy: false, error: "", success: "" });

  async function handleRepair() {
    if (!sessionId) {
      setStatus({ busy: false, error: "Missing payment reference. Please contact hello@cleartill.money.", success: "" });
      return;
    }

    setStatus({ busy: true, error: "", success: "" });

    try {
      const response = await fetch("/api/stripe/repair-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "We could not repair your access right now.");
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SESSION_STORAGE_KEY, sessionId);
      }

      setStatus({
        busy: false,
        error: "",
        success: successMessage,
      });

      if (typeof onSuccess === "function") {
        onSuccess(payload);
      }
    } catch (error) {
      setStatus({
        busy: false,
        error: error?.message || "We could not repair your access right now.",
        success: "",
      });
    }
  }

  return (
    <div className="billing-repair-block">
      <button
        className="secondary-button"
        type="button"
        onClick={handleRepair}
        disabled={status.busy}
      >
        {status.busy ? busyLabel : idleLabel}
      </button>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">{status.error}</p>
      ) : null}
      {status.success ? (
        <p className="helper-text billing-success" aria-live="polite">{status.success}</p>
      ) : null}
    </div>
  );
}
