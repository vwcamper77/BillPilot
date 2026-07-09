"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

export default function FoundingFeedbackForm() {
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState({ busy: false, error: "", success: "" });

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      setStatus({ busy: false, error: "Please share what made you pay today.", success: "" });
      return;
    }

    setStatus({ busy: true, error: "", success: "" });

    try {
      const headers = {
        "Content-Type": "application/json",
      };
      const currentUser = auth?.currentUser;

      if (currentUser) {
        const idToken = await currentUser.getIdToken().catch(() => "");

        if (idToken) {
          headers.Authorization = `Bearer ${idToken}`;
        }
      }

      const response = await fetch("/api/founding-feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: trimmedAnswer,
          page: "stripe-success",
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Sorry, we could not save that feedback. Please try again.");
      }

      setAnswer("");
      setStatus({
        busy: false,
        error: "",
        success: "Thank you — that really helps shape ClearTill.",
      });
    } catch (error) {
      setStatus({
        busy: false,
        error: error?.message || "Sorry, we could not save that feedback. Please try again.",
        success: "",
      });
    }
  }

  return (
    <form className="billing-feedback-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="founding-feedback-answer">
        What made you pay today?
      </label>
      <textarea
        id="founding-feedback-answer"
        className="billing-feedback-input"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="For example: I wanted a clearer view of what I'm clear to spend before I'm paid."
        rows={4}
      />
      <div className="billing-feedback-actions">
        <button className="secondary-button" type="submit" disabled={status.busy}>
          {status.busy ? "Saving…" : "Send feedback"}
        </button>
      </div>
      {status.error ? (
        <p className="helper-text billing-error" aria-live="polite">{status.error}</p>
      ) : null}
      {status.success ? (
        <p className="helper-text billing-success" aria-live="polite">{status.success}</p>
      ) : null}
    </form>
  );
}
