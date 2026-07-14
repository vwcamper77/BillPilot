import { auth } from "@/lib/firebase";

function getSessionId() {
  if (typeof window === "undefined") {
    return "";
  }

  const existing = window.localStorage.getItem("cleartill_analytics_session");
  if (existing) {
    return existing;
  }

  const created = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem("cleartill_analytics_session", created);
  return created;
}

export async function trackClientAnalyticsEvent(eventName, payload = {}) {
  try {
    if (typeof window !== "undefined" && window.__CLEARTILL_INTERNAL_ANALYTICS__) return;
    const headers = { "Content-Type": "application/json" };
    const currentUser = auth?.currentUser;

    if (currentUser) {
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }

    await fetch("/api/analytics", {
      method: "POST",
      headers,
      body: JSON.stringify({
        eventName,
        payload,
        sessionId: getSessionId(),
      }),
    });
  } catch {
    // Analytics must never block the product.
  }
}
