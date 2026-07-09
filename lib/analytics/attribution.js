"use client";

/**
 * First-touch attribution capture, stored client-side so it survives from
 * the marketing site through to account creation (where it's attached to
 * the customer record server-side). Independent of Firebase auth — an
 * anonymousSessionId exists before any Firebase user does.
 */

const ANON_ID_KEY = "ct_anon_id";
const ATTRIBUTION_KEY = "ct_attribution";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getOrCreateAnonymousSessionId() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const existing = storage.getItem(ANON_ID_KEY);
    if (existing) {
      return existing;
    }

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    storage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Idempotent: only captures UTM/fbclid/gclid/referrer/landing-page on the
 * first call ever made for this browser. Safe to call on every page view.
 */
export function captureAttributionIfFirstTouch() {
  const storage = getStorage();
  if (!storage) {
    return { isFirstTouch: false, bundle: null };
  }

  try {
    const existingRaw = storage.getItem(ATTRIBUTION_KEY);
    if (existingRaw) {
      return { isFirstTouch: false, bundle: JSON.parse(existingRaw) };
    }

    const params = new URLSearchParams(window.location.search);
    const bundle = {
      anonymousSessionId: getOrCreateAnonymousSessionId(),
      referrer: document.referrer || null,
      landingPage: window.location.pathname,
      firstSeenAt: new Date().toISOString(),
      fbclid: params.get("fbclid") || null,
      gclid: params.get("gclid") || null,
    };

    for (const key of UTM_KEYS) {
      bundle[key] = params.get(key) || null;
    }

    storage.setItem(ATTRIBUTION_KEY, JSON.stringify(bundle));
    return { isFirstTouch: true, bundle };
  } catch {
    return { isFirstTouch: false, bundle: null };
  }
}

export function getStoredAttribution() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
