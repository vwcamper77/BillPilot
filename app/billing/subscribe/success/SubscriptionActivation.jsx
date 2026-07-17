"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady } from "@/lib/firebase";

export default function SubscriptionActivation({ sessionId }) {
  const confirmationStartedRef = useRef(false);
  const [state, setState] = useState(sessionId ? "confirming" : "error");
  const [message, setMessage] = useState(sessionId
    ? "Confirming your paid ClearTill subscription with Stripe..."
    : "Stripe did not return a checkout reference.");

  useEffect(() => {
    if (!sessionId || !auth) return undefined;
    let active = true;
    let unsubscribe = () => undefined;
    let retryTimer = null;

    authPersistenceReady.then(() => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!active || !user || confirmationStartedRef.current) return;
        confirmationStartedRef.current = true;
        let attempts = 0;

        const confirm = async () => {
          attempts += 1;
          try {
            const response = await fetch("/api/stripe/confirm-subscription", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
              body: JSON.stringify({ sessionId }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not confirm the subscription.");
            if (!active) return;
            if (payload.outcome === "confirmed") {
              setState("active");
              setMessage("Your paid subscription is active and live editing has been restored.");
            } else if (payload.outcome === "failed") {
              setState("error");
              setMessage("The subscription could not be confirmed. Return to pricing or contact support to recover.");
            } else if (attempts < 15) {
              setState("pending");
              setMessage("Stripe confirmation is still arriving. This page will update automatically.");
              retryTimer = window.setTimeout(confirm, 2000);
            } else {
              setState("pending");
              setMessage("Confirmation is taking longer than expected. Your Stripe webhook will still restore access when it arrives.");
            }
          } catch (error) {
            if (!active) return;
            confirmationStartedRef.current = false;
            setState("error");
            setMessage(error?.message || "Your checkout completed, but activation is taking longer than expected.");
          }
        };
        await confirm();
      });
    }).catch(() => {
      if (!active) return;
      setState("error");
      setMessage("Sign in again to confirm your subscription.");
    });

    return () => {
      active = false;
      unsubscribe();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [sessionId]);

  return (
    <>
      <p className="eyebrow">Paid subscription</p>
      <h1>{state === "active" ? "Your ClearTill subscription is active" : "Activating your ClearTill subscription"}</h1>
      <p aria-live="polite">{message}</p>
      {state === "active" ? (
        <div className="auth-button-row">
          <Link className="primary-button" href="/dashboard">Open ClearTill</Link>
          <Link className="secondary-button" href="/account">Manage subscription</Link>
        </div>
      ) : null}
      {state === "error" || state === "pending" ? <p className="helper-text">Stripe also sends ClearTill a secure confirmation. If payment completed, access should appear shortly.</p> : null}
    </>
  );
}
