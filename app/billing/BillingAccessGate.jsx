"use client";

import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import CheckoutButton from "./CheckoutButton";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";

const INITIAL_FORM = { email: "", password: "" };

export default function BillingAccessGate() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState(INITIAL_FORM);
  const [status, setStatus] = useState({ busy: false, error: "" });

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    let isMounted = true;
    let unsubscribe = () => undefined;

    authPersistenceReady.finally(() => {
      if (!isMounted) {
        return;
      }

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
        setStatus({ busy: false, error: "" });
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!auth) {
      setStatus({ busy: false, error: "Sign-in is not available right now. Please try again shortly." });
      return;
    }

    const email = form.email.trim();
    const password = form.password;

    if (!email || !password) {
      setStatus({ busy: false, error: "Enter your email and password to continue." });
      return;
    }

    setStatus({ busy: true, error: "" });

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      setForm(INITIAL_FORM);
    } catch (error) {
      setStatus({
        busy: false,
        error: friendlyAuthError(error, mode),
      });
    }
  }

  if (!isFirebaseClientConfigured) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Sign-in is not available right now.</p>
        <p className="billing-access-copy">
          Please try again shortly.
        </p>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Loading your ClearTill login...</p>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Save your access first</p>
        <p className="billing-access-copy">
          Create a quick ClearTill login so your £5 founding member access is saved to you.
        </p>
        <p className="billing-access-note">
          No bank login. No Open Banking. No card details stored by ClearTill.
        </p>

        <form className="billing-auth-form" onSubmit={handleSubmit}>
          <div className="field-row">
            <label className="field-label" htmlFor="billing-email">Email</label>
            <input
              id="billing-email"
              type="email"
              autoComplete={mode === "signup" ? "email" : "username"}
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="you@example.com"
            />
          </div>

          <div className="field-row">
            <label className="field-label" htmlFor="billing-password">Password</label>
            <input
              id="billing-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            />
          </div>

          <div className="billing-access-actions">
            <button className="primary-button billing-primary-button" type="submit" disabled={status.busy}>
              {status.busy
                ? mode === "signup"
                  ? "Saving your login..."
                  : "Signing you in..."
                : mode === "signup"
                  ? "Continue with email"
                  : "Sign in and continue"}
            </button>
            <button
              className="quiet-link billing-access-toggle"
              type="button"
              onClick={() => {
                setMode((current) => (current === "signup" ? "signin" : "signup"));
                setStatus({ busy: false, error: "" });
              }}
            >
              {mode === "signup" ? "I already have an account" : "I need to create an account"}
            </button>
          </div>
        </form>

        {status.error ? (
          <p className="helper-text billing-error" aria-live="polite">{status.error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="billing-access-panel">
      <p className="billing-access-title">Ready to activate your access</p>
      <p className="billing-access-copy">
        Your ClearTill login is ready. Continue to Stripe to activate 3 months&apos; founding member access for £5.
      </p>
      <p className="billing-access-status">
        Access will be saved to {user.email || user.displayName || "your ClearTill login"}.
      </p>
      <CheckoutButton />
      <p className="billing-access-note">
        Secure checkout is hosted by Stripe. ClearTill does not store card details.
      </p>
    </div>
  );
}

function friendlyAuthError(error, mode) {
  const code = String(error?.code || "");

  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/email-already-in-use") return "That email already has a ClearTill login. Sign in instead.";
  if (code === "auth/weak-password") return "Use a password with at least 6 characters.";
  if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "That email or password doesn't look right.";
  }
  if (code === "auth/too-many-requests") return "Too many attempts right now. Please try again in a few minutes.";
  if (code === "auth/network-request-failed") return "Check your connection and try again.";

  return mode === "signup"
    ? "We couldn't create your login right now. Please try again."
    : "We couldn't sign you in right now. Please try again.";
}
