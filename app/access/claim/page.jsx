"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import Link from "next/link";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";
import { trackGa4Event } from "@/lib/analytics/ga4";

const FIREBASE_ERROR_MESSAGES = {
  "auth/expired-action-code": "This access link has expired.",
  "auth/invalid-action-code": "This access link has already been used or is no longer valid.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/user-disabled": "This account is disabled. Contact hello@cleartill.money.",
};

const API_ERROR_MESSAGES = {
  invalid_token: "This access link is not valid.",
  link_expired: "This access link has expired.",
  already_claimed: "This access link has already been used.",
  email_mismatch: "That email doesn't match the one used at checkout.",
};

export default function AccessClaimPage() {
  const router = useRouter();
  const [phase, setPhase] = useState("loading"); // loading | need-email | working | error | done
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [canResend, setCanResend] = useState(false);
  const [resendState, setResendState] = useState({ busy: false, sent: false });
  const paramsRef = useRef({ href: "", ct: "", sid: "" });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const ct = url.searchParams.get("ct") || "";
    const sid = url.searchParams.get("sid") || "";
    paramsRef.current = { href: window.location.href, ct, sid };

    // Scrub the token/oobCode/apiKey out of the visible URL and history
    // immediately — signInWithEmailLink already has what it needs in memory.
    window.history.replaceState(null, "", "/access/claim");

    trackGa4Event("access_link_opened", {});

    if (!auth) {
      setPhase("error");
      setMessage("Sign-in is not available right now.");
      return;
    }

    if (!isSignInWithEmailLink(auth, paramsRef.current.href)) {
      setPhase("error");
      setMessage("This link is not a valid sign-in link.");
      setCanResend(Boolean(sid));
      return;
    }

    setPhase("need-email");
  }, []);

  async function completeSignIn(enteredEmail) {
    setPhase("working");
    setMessage("");

    try {
      await authPersistenceReady;
      const credential = await signInWithEmailLink(auth, enteredEmail, paramsRef.current.href);
      const isNewUser = Boolean(credential?._tokenResponse?.isNewUser ?? credential?.additionalUserInfo?.isNewUser);
      const idToken = await credential.user.getIdToken();

      const response = await fetch("/api/access/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          claimToken: paramsRef.current.ct,
          sessionId: paramsRef.current.sid,
          isNewUser,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const code = payload?.code;
        setPhase("error");
        setMessage(API_ERROR_MESSAGES[code] || payload?.error || "We could not activate your access.");
        setCanResend(code === "link_expired" || code === "invalid_token");
        return;
      }

      setPhase("done");
      router.replace("/dashboard?onboarding=1");
    } catch (error) {
      const code = error?.code;
      setPhase("error");
      setMessage(FIREBASE_ERROR_MESSAGES[code] || "We could not sign you in with this link.");
      setCanResend(code === "auth/expired-action-code" || code === "auth/invalid-action-code");
    }
  }

  async function handleResend() {
    if (!paramsRef.current.sid) return;
    setResendState({ busy: true, sent: false });

    try {
      const response = await fetch("/api/access/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: paramsRef.current.sid }),
      });

      if (!response.ok) throw new Error();
      setResendState({ busy: false, sent: true });
    } catch {
      setResendState({ busy: false, sent: false });
    }
  }

  return (
    <main className="billing-shell billing-shell-success">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand billing-success-eyebrow">Sign in to ClearTill</h1>
        </div>
      </header>

      <section className="billing-panel billing-status-panel">
        {phase === "loading" ? <p className="helper-text">Checking your link...</p> : null}

        {phase === "need-email" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              completeSignIn(email.trim().toLowerCase());
            }}
          >
            <p className="billing-status-copy">
              Confirm the email you used at checkout to finish signing in.
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="billing-email-input"
            />
            <button className="primary-button billing-primary-button" type="submit">
              Continue
            </button>
          </form>
        ) : null}

        {phase === "working" ? <p className="helper-text">Signing you in...</p> : null}
        {phase === "done" ? <p className="helper-text billing-success">You&apos;re in — redirecting...</p> : null}

        {phase === "error" ? (
          <div>
            <p className="helper-text billing-error">{message}</p>
            {canResend ? (
              <div className="billing-cta-stack">
                <button className="secondary-button" type="button" onClick={handleResend} disabled={resendState.busy}>
                  {resendState.busy ? "Resending..." : "Resend access link"}
                </button>
                {resendState.sent ? <p className="helper-text billing-success">Access link sent.</p> : null}
              </div>
            ) : null}
            <p className="helper-text">Need help? Contact hello@cleartill.money.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
