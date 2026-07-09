"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

export default function AdminFoundingAccessForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ busy: false, error: "", success: "" });

  async function handleSubmit(event) {
    event.preventDefault();

    if (!auth?.currentUser) {
      setStatus({ busy: false, error: "Sign in first.", success: "" });
      return;
    }

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setStatus({ busy: false, error: "Enter an email address.", success: "" });
      return;
    }

    setStatus({ busy: true, error: "", success: "" });

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/admin/founding-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not mark that user as a founding member.");
      }

      setStatus({
        busy: false,
        error: "",
        success: payload?.message || "Founding access granted.",
      });
      setEmail("");
    } catch (error) {
      setStatus({
        busy: false,
        error: error?.message || "Could not mark that user as a founding member.",
        success: "",
      });
    }
  }

  return (
    <form className="billing-feedback-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="admin-founding-email">Grant founding access by email</label>
      <input
        id="admin-founding-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="customer@example.com"
      />
      <div className="billing-feedback-actions">
        <button className="primary-button" type="submit" disabled={status.busy}>
          {status.busy ? "Saving..." : "Grant 3 months access"}
        </button>
      </div>
      {status.error ? <p className="helper-text billing-error">{status.error}</p> : null}
      {status.success ? <p className="helper-text billing-success">{status.success}</p> : null}
    </form>
  );
}
