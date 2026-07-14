"use client";

export function trackGa4Event(eventName, parameters = {}) {
  if (typeof window === "undefined" || window.__CLEARTILL_INTERNAL_ANALYTICS__ || typeof window.gtag !== "function") return;
  window.gtag("event", eventName, parameters);
}

export function getGaClientId() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/);
  return match?.[1] || null;
}
