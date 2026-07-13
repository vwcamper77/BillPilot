"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmailAuthProvider,
  isSignInWithEmailLink,
  linkWithCredential,
  signInWithEmailLink,
} from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";

const LINK_CONFLICT_CODES = new Set([
  "auth/credential-already-in-use",
  "auth/email-already-in-use",
  "auth/provider-already-linked",
]);

export default function TrialClaimPage() {
  const router = useRouter();
  const claimRef = useRef({ href: "", checkoutIntentId: "", claimToken: "" });
  const [phase, setPhase] = useState("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const href = window.location.href;
    const url = new URL(href);
    const checkoutIntentId = url.searchParams.get("cid") || "";
    const claimToken = url.searchParams.get("ct") || "";
    claimRef.current = { href, checkoutIntentId, claimToken };
    window.history.replaceState(null, "", "/trial/claim");

    if (!auth || !checkoutIntentId || !claimToken || !isSignInWithEmailLink(auth, href)) {
      setPhase("error");
      setMessage("This secure ClearTill link is not valid.");
      return;
    }
    void completeClaim();
  }, []);

  async function completeClaim() {
    setPhase("working");
    try {
      const emailResponse = await fetch("/api/trial-claim/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutIntentId: claimRef.current.checkoutIntentId,
          claimToken: claimRef.current.claimToken,
        }),
      });
      const emailPayload = await emailResponse.json().catch(() => ({}));
      if (!emailResponse.ok || !emailPayload?.email) throw new Error(emailPayload?.error || "This secure link is not valid.");

      await authPersistenceReady;
      let credential;
      if (auth.currentUser?.isAnonymous) {
        const emailCredential = EmailAuthProvider.credentialWithLink(emailPayload.email, claimRef.current.href);
        try {
          credential = await linkWithCredential(auth.currentUser, emailCredential);
        } catch (error) {
          if (!LINK_CONFLICT_CODES.has(error?.code)) throw error;
          credential = await signInWithEmailLink(auth, emailPayload.email, claimRef.current.href);
        }
      } else {
        credential = await signInWithEmailLink(auth, emailPayload.email, claimRef.current.href);
      }

      const claimResponse = await fetch("/api/trial-claim/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await credential.user.getIdToken()}`,
        },
        body: JSON.stringify({
          checkoutIntentId: claimRef.current.checkoutIntentId,
          claimToken: claimRef.current.claimToken,
        }),
      });
      const claimPayload = await claimResponse.json().catch(() => ({}));
      if (!claimResponse.ok || !claimPayload?.ok) throw new Error(claimPayload?.error || "ClearTill could not secure this account.");

      setPhase("done");
      router.replace("/dashboard?claim=complete");
    } catch (error) {
      setPhase("error");
      setMessage(error?.message || "ClearTill could not secure this account. Request a fresh link from the original browser.");
    }
  }

  return (
    <main className="billing-shell billing-shell-success">
      <header className="topbar">
        <Link className="brand-link" href="/" aria-label="ClearTill home"><Logo className="eyebrow-logo" /></Link>
      </header>
      <section className="billing-panel billing-status-panel">
        <p className="eyebrow">Secure ClearTill access</p>
        <h1>{phase === "done" ? "Your ClearTill account is ready" : "Opening ClearTill securely"}</h1>
        {phase === "checking" || phase === "working" ? <p className="helper-text">Verifying your secure email link…</p> : null}
        {phase === "done" ? <p className="helper-text billing-success">Access secured. Redirecting to your dashboard…</p> : null}
        {phase === "error" ? (
          <>
            <p className="helper-text billing-error">{message}</p>
            <p className="helper-text">Open ClearTill in the browser where you started the trial to resend a secure link.</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
