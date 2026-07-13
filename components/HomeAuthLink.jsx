"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";

export default function HomeAuthLink() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isFirebaseClientConfigured || !auth) {
      setReady(true);
      return undefined;
    }

    let active = true;
    let unsubscribe = null;

    authPersistenceReady
      .catch(() => undefined)
      .then(() => {
        if (!active) return;

        unsubscribe = onAuthStateChanged(auth, (user) => {
          if (!active) return;
          setUser(user && !user.isAnonymous ? user : null);
          setReady(true);
        });

        if (!active) {
          unsubscribe();
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function openStripePortal() {
    if (!user || busy) return;

    setBusy(true);
    setError("");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not open Stripe right now.");
      }

      window.location.assign(payload.url);
    } catch (failure) {
      setError(failure?.message || "Could not open Stripe right now.");
      setBusy(false);
    }
  }

  if (ready && user) {
    return (
      <>
        <button
          className="secondary-button home-signin-button"
          type="button"
          onClick={openStripePortal}
          disabled={busy}
        >
          {busy ? "Opening..." : "Account"}
        </button>
        {error ? <p className="home-signin-error" role="alert">{error}</p> : null}
      </>
    );
  }

  return (
    <Link className="secondary-button home-signin-button" href="/dashboard?auth=signin">
      Sign in
    </Link>
  );
}
