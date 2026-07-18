"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import Logo from "@/components/Logo";
import {
  auth,
  authPersistenceReady,
  googleProvider,
  isFirebaseClientConfigured,
} from "@/lib/firebase";
import { friendlyGoogleAuthError, logGoogleAuthError } from "@/lib/googleAuthErrors";
import { trackEvent } from "@/lib/analytics/track";

const ATTRIBUTION_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
];

function onboardingPath(searchParams) {
  const target = new URLSearchParams({ mode: "onboarding", step: "balance" });
  for (const key of ATTRIBUTION_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value) target.set(key, value);
  }
  return `/dashboard?${target.toString()}`;
}

function authMessage(error, action) {
  const code = String(error?.code || "");
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential"].includes(code)) {
    return "That email or password does not match an account. Check both and try again.";
  }
  if (code === "auth/email-already-in-use") return "An account already uses this email. Sign in instead.";
  if (code === "auth/weak-password") return "Choose a password with at least six characters.";
  if (code === "auth/too-many-requests") return "Too many attempts were made. Wait a few minutes, then try again.";
  if (code === "auth/popup-closed-by-user") return "The Google window was closed before you finished. Try again when ready.";
  if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(code)) {
    return "Your browser blocked the Google window. Allow pop-ups for ClearTill or use email.";
  }
  if (code === "auth/network-request-failed") return "Check your internet connection and try again.";
  if (code === "auth/user-disabled") return "This account is disabled. Contact hello@cleartill.money for help.";
  return action === "signup"
    ? "We could not create your account just now. Try again or use the other sign-up option."
    : "We could not sign you in just now. Try again or use the other sign-in option.";
}

export default function AuthJourney({ mode }) {
  const isSignup = mode === "signup";
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextAfterSignup = useMemo(() => onboardingPath(searchParams), [searchParams]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetState, setResetState] = useState("");
  const authAttemptRef = useRef(false);

  useEffect(() => {
    if (!auth || !isFirebaseClientConfigured) {
      setReady(true);
      return undefined;
    }

    let active = true;
    let unsubscribe = () => undefined;
    authPersistenceReady.finally(() => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (!active) return;
        if (isSignup && currentUser && !currentUser.isAnonymous && !authAttemptRef.current) {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isSignup, router]);

  useEffect(() => {
    if (isSignup) trackEvent("signup_started", { source: "start" });
  }, [isSignup]);

  function finish(user, method) {
    if (isSignup) {
      trackEvent("account_created", { method });
      trackEvent("onboarding_started", { source: "start" });
      router.replace(nextAfterSignup);
    } else {
      trackEvent("login", { method });
      router.replace("/dashboard");
    }
  }

  async function continueWithGoogle() {
    if (!auth || !googleProvider) {
      setError("Account access is temporarily unavailable. Try again later.");
      return;
    }
    setBusy("google");
    authAttemptRef.current = true;
    setError("");
    setResetState("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (isSignup && !getAdditionalUserInfo(result)?.isNewUser) {
        trackEvent("login", { method: "google" });
        router.replace("/dashboard");
        return;
      }
      finish(result.user, "google");
    } catch (authError) {
      logGoogleAuthError(authError, `auth-journey-${mode}`);
      setError(friendlyGoogleAuthError(authError));
    } finally {
      authAttemptRef.current = false;
      setBusy("");
    }
  }

  async function submitEmail(event) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError(isSignup ? "Create a password with at least six characters." : "Enter your password.");
      return;
    }
    if (isSignup && password.length < 6) {
      setError("Choose a password with at least six characters.");
      return;
    }
    if (!auth) {
      setError("Account access is temporarily unavailable. Try again later.");
      return;
    }

    setBusy("email");
    authAttemptRef.current = true;
    setError("");
    setResetState("");
    try {
      await authPersistenceReady;
      const result = isSignup
        ? await createUserWithEmailAndPassword(auth, cleanEmail, password)
        : await signInWithEmailAndPassword(auth, cleanEmail, password);
      finish(result.user, "email");
    } catch (authError) {
      setError(authMessage(authError, mode));
    } finally {
      authAttemptRef.current = false;
      setBusy("");
    }
  }

  async function resetPassword() {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("Enter your email above, then select ‘Forgot password?’ again.");
      return;
    }
    if (!auth) {
      setError("Password reset is temporarily unavailable. Try again later.");
      return;
    }
    setBusy("reset");
    setError("");
    setResetState("");
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setResetState("Check your inbox for a password reset link.");
    } catch (authError) {
      setError(authMessage(authError, "signin"));
    } finally {
      setBusy("");
    }
  }

  const disabled = Boolean(busy) || !ready;

  return (
    <main className="acquisition-shell">
      <header className="acquisition-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="acquisition-logo" height={40} /></Link>
        <nav aria-label="Account navigation">
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
        </nav>
      </header>

      <div className={`auth-journey-grid${isSignup ? "" : " auth-journey-grid-signin"}`}>
        <section className="auth-journey-copy">
          <p className="acquisition-eyebrow">{isSignup ? "No bank connection. No card required." : "Welcome back"}</p>
          <h1>{isSignup ? "Save your first ClearTill position securely" : "Sign in to ClearTill"}</h1>
          <p>{isSignup
            ? "Create an account so your balance, payday and upcoming costs remain connected to you and can be updated when things change."
            : "Return to your saved position, update what has changed and see where you stand before payday."}</p>

          {isSignup ? (
            <aside className="auth-trust-panel">
              <h2>Why ClearTill needs an account</h2>
              <p>Your account lets ClearTill save your position, send your chosen check-ins and let you return on another device.</p>
              <ul>
                <li>No bank connection</li>
                <li>No Open Banking</li>
                <li>No card required</li>
                <li>Your seven-day preview starts only when your first complete position is saved</li>
              </ul>
            </aside>
          ) : null}
        </section>

        <section className="auth-form-card" aria-labelledby="auth-form-title">
          <h2 id="auth-form-title">{isSignup ? "Create your account" : "Sign in"}</h2>
          <button className="auth-google-button" type="button" onClick={continueWithGoogle} disabled={disabled}>
            <span aria-hidden="true">G</span>{busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <div className="auth-route-divider" aria-hidden="true"><span>or</span></div>
          <form onSubmit={submitEmail} noValidate>
            <label htmlFor={`${mode}-email`}>Email</label>
            <input id={`${mode}-email`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" disabled={disabled} />
            <label htmlFor={`${mode}-password`}>{isSignup ? "Create a password" : "Password"}</label>
            <input id={`${mode}-password`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignup ? "new-password" : "current-password"} disabled={disabled} />
            {!isSignup ? <button className="auth-text-button" type="button" onClick={resetPassword} disabled={disabled}>Forgot password?</button> : null}
            <button className="auth-submit-button" type="submit" disabled={disabled}>
              {busy === "email" ? (isSignup ? "Creating your account…" : "Signing you in…") : (isSignup ? "Create my ClearTill account" : "Sign in")}
            </button>
          </form>
          {error ? <p className="auth-inline-message auth-inline-error" role="alert">{error}</p> : null}
          {resetState ? <p className="auth-inline-message auth-inline-success" role="status">{resetState}</p> : null}
          <p className="auth-switch-link">{isSignup ? <>Already have an account? <Link href="/signin">Sign in</Link></> : <>New to ClearTill? <Link href="/start">Create your account</Link></>}</p>
          {isSignup ? (
            <p className="auth-consent-copy">By continuing, you agree to ClearTill’s <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>. ClearTill sends essential account and preview emails. Optional reminders can be changed in settings.</p>
          ) : null}
        </section>
      </div>

      {isSignup ? (
        <section className="auth-next-steps">
          <p className="acquisition-eyebrow">What happens next</p>
          <ol>
            <li><span>1</span>Add your current balance</li>
            <li><span>2</span>Add your payday and upcoming costs</li>
            <li><span>3</span>See your first ClearTill position</li>
            <li><span>4</span>Use live updates and reminders for seven days</li>
          </ol>
        </section>
      ) : null}
    </main>
  );
}
