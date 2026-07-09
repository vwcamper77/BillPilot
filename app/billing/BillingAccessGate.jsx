"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import CheckoutButton from "./CheckoutButton";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";

const SIGNIN_PATH = "/dashboard?auth=signin&next=%2Fbilling";
const SIGNUP_PATH = "/dashboard?auth=signup&next=%2Fbilling";

export default function BillingAccessGate() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);

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
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  if (!isFirebaseClientConfigured) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Sign-in is not available right now.</p>
        <p className="billing-access-copy">
          Firebase auth is not configured, so checkout cannot be linked to an account yet.
        </p>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Loading your ClearTill account access...</p>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="billing-access-panel">
        <p className="billing-access-title">Create an account or sign in before checkout.</p>
        <p className="billing-access-copy">
          Founding access is now attached to a real Firebase login, so Stripe checkout only opens for saved accounts.
        </p>
        <div className="billing-access-actions">
          <Link className="primary-link" href={SIGNUP_PATH}>
            Create account
          </Link>
          <Link className="secondary-button" href={SIGNIN_PATH}>
            Existing user sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="billing-access-panel">
      <p className="billing-access-title">Signed in and ready for checkout.</p>
      <p className="billing-access-status">
        Founding access will be attached to {user.email || user.displayName || "your ClearTill account"}.
      </p>
      <CheckoutButton />
    </div>
  );
}
