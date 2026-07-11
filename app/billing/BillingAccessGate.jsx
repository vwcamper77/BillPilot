"use client";

import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  linkWithPopup,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import CheckoutButton from "./CheckoutButton";
import { auth, authPersistenceReady, googleProvider, isFirebaseClientConfigured } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics/track";
import { getStoredAttribution } from "@/lib/analytics/attribution";
import { trackGa4Event } from "@/lib/analytics/ga4";

const INITIAL_FORM = { email: "", password: "" };
const AUTH_CONTEXT = "founding_member_checkout";

// Codes where the person deliberately backed out (closed the popup / superseded it) vs a genuine failure.
const CANCELLED_AUTH_CODES = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

// Allowlist so only recognised Firebase auth codes ever reach GA4 — never the raw message (which can carry the email).
const KNOWN_AUTH_ERROR_CODES = new Set([
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/popup-closed-by-user",
  "auth/unauthorized-domain",
  "auth/operation-not-allowed",
  "auth/credential-already-in-use",
  "auth/network-request-failed",
  "auth/too-many-requests",
  "auth/invalid-email",
  "auth/email-already-in-use",
  "auth/weak-password",
  "auth/user-not-found",
  "auth/wrong-password",
  "auth/invalid-credential",
]);

function sanitizedErrorType(error) {
  const code = String(error?.code || "");
  return KNOWN_AUTH_ERROR_CODES.has(code) ? code.replace("auth/", "") : "unknown";
}

function trackAuthOutcome(error, method) {
  if (CANCELLED_AUTH_CODES.has(String(error?.code || ""))) {
    trackGa4Event("auth_cancelled", { method, context: AUTH_CONTEXT });
  } else {
    trackGa4Event("auth_failed", { method, context: AUTH_CONTEXT, error_type: sanitizedErrorType(error) });
  }
}

export default function BillingAccessGate() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState(INITIAL_FORM);
  const [status, setStatus] = useState({ busy: false, error: "" });
  const authAttemptRef = useRef(false);
  const checkoutReadyUidRef = useRef(null);

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
        trackEvent("paywall_viewed");

        const isCheckoutReady = Boolean(currentUser) && !currentUser.isAnonymous;
        if (isCheckoutReady && checkoutReadyUidRef.current !== currentUser.uid) {
          checkoutReadyUidRef.current = currentUser.uid;
          trackGa4Event("checkout_ready", { context: AUTH_CONTEXT });
        } else if (!isCheckoutReady) {
          checkoutReadyUidRef.current = null;
        }
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  function trackAccountCreated(method) {
    trackEvent("account_created", { method, attribution: getStoredAttribution() });
    trackEvent("onboarding_started");
  }

  async function handleGoogleSignIn() {
    if (!auth || !googleProvider) {
      setStatus({ busy: false, error: "Sign-in is not available right now. Please try again shortly." });
      return;
    }

    if (authAttemptRef.current) return;
    authAttemptRef.current = true;

    setStatus({ busy: true, error: "" });
    trackGa4Event("auth_start", { method: "google", context: AUTH_CONTEXT });

    try {
      if (auth.currentUser?.isAnonymous) {
        await linkWithPopup(auth.currentUser, googleProvider);
        trackAccountCreated("google");
        trackGa4Event("sign_up", { method: "google", context: AUTH_CONTEXT });
        setStatus({ busy: false, error: "" });
        return;
      }

      const result = await signInWithPopup(auth, googleProvider);
      if (getAdditionalUserInfo(result)?.isNewUser) {
        trackAccountCreated("google");
        trackGa4Event("sign_up", { method: "google", context: AUTH_CONTEXT });
      } else {
        trackEvent("login", { method: "google" });
        trackGa4Event("login", { method: "google", context: AUTH_CONTEXT });
      }
      setStatus({ busy: false, error: "" });
    } catch (error) {
      if (error?.code === "auth/credential-already-in-use" && auth.currentUser?.isAnonymous) {
        try {
          await auth.currentUser.delete().catch(() => signOut(auth));
          const retryResult = await signInWithPopup(auth, googleProvider);
          if (getAdditionalUserInfo(retryResult)?.isNewUser) {
            trackAccountCreated("google");
            trackGa4Event("sign_up", { method: "google", context: AUTH_CONTEXT });
          } else {
            trackEvent("login", { method: "google" });
            trackGa4Event("login", { method: "google", context: AUTH_CONTEXT });
          }
          setStatus({ busy: false, error: "" });
          return;
        } catch (retryError) {
          trackAuthOutcome(retryError, "google");
          setStatus({ busy: false, error: friendlyGoogleAuthError(retryError) });
          return;
        }
      }

      trackAuthOutcome(error, "google");
      setStatus({ busy: false, error: friendlyGoogleAuthError(error) });
    } finally {
      authAttemptRef.current = false;
    }
  }

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

    if (authAttemptRef.current) return;
    authAttemptRef.current = true;

    setStatus({ busy: true, error: "" });

    try {
      if (mode === "signup") {
        trackEvent("signup_started", { method: "password" });
        trackGa4Event("auth_start", { method: "password", context: AUTH_CONTEXT });
        await createUserWithEmailAndPassword(auth, email, password);
        trackEvent("account_created", { method: "password", attribution: getStoredAttribution() });
        trackEvent("onboarding_started");
        trackGa4Event("sign_up", { method: "password", context: AUTH_CONTEXT });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        trackEvent("login", { method: "password" });
        trackGa4Event("login", { method: "password", context: AUTH_CONTEXT });
      }

      setForm(INITIAL_FORM);
    } catch (error) {
      trackAuthOutcome(error, "password");
      setStatus({
        busy: false,
        error: friendlyAuthError(error, mode),
      });
    } finally {
      authAttemptRef.current = false;
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

        <button
          className="primary-button billing-primary-button"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={status.busy}
        >
          {status.busy ? "Signing in…" : "Continue with Google"}
        </button>

        <div className="auth-divider" aria-hidden="true"><span>or</span></div>

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
        Your ClearTill login is ready. Continue to Stripe to activate 90 days of founding member access for £5.
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

function friendlyGoogleAuthError(error) {
  const code = String(error?.code || "");

  if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was blocked by the browser. Please try again, or use email sign-in.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Google sign-in isn't available on this domain yet.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled yet. Please use email sign-in.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was closed before finishing. Please try again.";
  }

  return "We couldn't sign you in with Google right now. Please try again, or use email sign-in.";
}
