"use client";

import { useState } from "react";

export default function RepairAccessButton({ sessionId }) {
  const [status, setStatus] = useState({ busy: false, error: "" });

  async function handleRepair() {
    if (!sessionId) {
      setStatus({ busy: false, error: "Missing payment reference. Please contact hello@cleartill.money." });
      return;
    }

    setStatus({ busy: true, error: "" });

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

      window.location.reload();
    } catch (error) {
      setStatus({
        busy: false,
        error: error?.message || "We could not repair your access right now.",
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
        {status.busy ? "Repairing access..." : "Repair my access"}
      </button>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">{status.error}</p>
      ) : null}
    </div>
  );
}
