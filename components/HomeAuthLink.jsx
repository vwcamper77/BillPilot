"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";

export default function HomeAuthLink() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

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

  if (ready && user) {
    return <Link className="secondary-button home-signin-button" href="/dashboard">Dashboard</Link>;
  }

  return (
    <Link className="secondary-button home-signin-button" href="/signin">
      Sign in
    </Link>
  );
}
