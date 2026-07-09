"use client";

import { useEffect } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Dev/test-only hook so the Playwright e2e suite can sign in as a specific
 * seeded Firebase user (minted via the Admin SDK) without driving a real
 * OAuth popup. Never mounted in production — see the guard in app/layout.jsx.
 */
export default function TestAuthBridge() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.__cleartillTestSignIn = (customToken) => signInWithCustomToken(auth, customToken);

    return () => {
      delete window.__cleartillTestSignIn;
    };
  }, []);

  return null;
}
