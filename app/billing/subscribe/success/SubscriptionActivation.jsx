"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady } from "@/lib/firebase";

export default function SubscriptionActivation({ sessionId }) {
  const confirmationStartedRef = useRef(false);
  const [state, setState] = useState(sessionId ? "confirming" : "error");
  const [message, setMessage] = useState(
    sessionId
      ? "Confirming your 7-day free trial with Stripe..."
      : "Stripe did not return a checkout reference.",
  );

  useEffect(() => {
    if (!sessionId || !auth) return undefined;

    let active = true;
    let unsubscribe = () => undefined;

    authPersistenceReady
      .then(() => {
        if (!active) return;
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!active || !user || confirmationStartedRef.current) return;
          confirmationStartedRef.current = true;

          try {
            const response = await fetch("/api/stripe/confirm-subscription", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${await user.getIdToken()}`,
              },
              body: JSON.stringify({ sessionId }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
              throw new Error(payload?.error || "Could not confirm the trial.");
            }
            if (!active) return;
            if (payload.outcome === "pending") {
              setState("pending");
              setMessage("Stripe confirmation is still pending. Refresh shortly; this page does not activate access or record revenue.");
            } else if (payload.outcome === "failed") {
              setState("error");
              setMessage("The trial could not be confirmed. Return to billing or contact support to recover.");
            } else {
              setState("active");
              setMessage("£0 was charged today. Your verified trial is active; the first payment is due after seven days.");
            }
          } catch (error) {
            if (!active) return;
            confirmationStartedRef.current = false;
            setState("error");
            setMessage(error?.message || "Your checkout completed, but activation is taking longer than expected.");
          }
        });
      })
      .catch(() => {
        if (!active) return;
        setState("error");
        setMessage("Sign in again to confirm your trial.");
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return (
    <>
      <p className="eyebrow">7-day free trial</p>
      <h1>{state === "active" ? "Your 7-day free trial is active" : "Activating your ClearTill trial"}</h1>
      <p aria-live="polite">{message}</p>
      {state === "active" ? (
        <div className="auth-button-row">
          <Link className="primary-button" href="/dashboard">Open ClearTill</Link>
          <Link className="secondary-button" href="/dashboard#secure-access">Check secure access link</Link>
        </div>
      ) : null}
      {state === "error" || state === "pending" ? (
        <p className="helper-text">Stripe also sends ClearTill a secure confirmation. If checkout completed, access should appear shortly.</p>
      ) : null}
    </>
  );
}
