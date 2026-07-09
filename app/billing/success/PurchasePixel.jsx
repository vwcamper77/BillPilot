"use client";

import { useEffect } from "react";
import { track } from "@/components/MetaPixel";

const FIRED_SESSION_STORAGE_KEY = "cleartill_purchase_pixel_fired_session_id";

export default function PurchasePixel({ sessionId, amount, currency }) {
  useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return;
    }

    if (window.sessionStorage.getItem(FIRED_SESSION_STORAGE_KEY) === sessionId) {
      return;
    }

    track(
      "Purchase",
      {
        value: amount,
        currency,
        content_name: "ClearTill founding access",
        content_category: "early_access",
      },
      sessionId,
    );

    window.sessionStorage.setItem(FIRED_SESSION_STORAGE_KEY, sessionId);
  }, [sessionId, amount, currency]);

  return null;
}
