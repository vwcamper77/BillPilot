"use client";

import { useEffect } from "react";

const RECENT_SESSION_STORAGE_KEY = "cleartill_recent_checkout_session_id";

export default function RememberCheckoutSession({ sessionId }) {
  useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_SESSION_STORAGE_KEY, sessionId);
  }, [sessionId]);

  return null;
}
