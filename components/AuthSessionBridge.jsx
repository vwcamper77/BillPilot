"use client";

import { useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth, authPersistenceReady } from "@/lib/firebase";
import {
  clearFirebaseSession,
  syncFirebaseSession,
} from "@/lib/firebaseSession.client";

const RETRY_DELAY_MS = 30_000;

export default function AuthSessionBridge() {
  useEffect(() => {
    if (!auth) return undefined;

    let active = true;
    let retryTimer;
    let unsubscribe = () => undefined;

    function clearRetry() {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    function sync(user) {
      clearRetry();
      const operation = user && !user.isAnonymous
        ? syncFirebaseSession(user)
        : clearFirebaseSession();
      operation.catch(() => {
        if (!active || !user || user.isAnonymous) return;
        retryTimer = window.setTimeout(() => sync(user), RETRY_DELAY_MS);
      });
    }

    authPersistenceReady.finally(() => {
      if (!active) return;
      unsubscribe = onIdTokenChanged(auth, sync);
    });

    return () => {
      active = false;
      clearRetry();
      unsubscribe();
    };
  }, []);

  return null;
}
