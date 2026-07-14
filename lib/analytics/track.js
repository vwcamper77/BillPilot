"use client";

/**
 * Client-side event tracker for the internal funnel/attribution system.
 * Fire-and-forget, like lib/security/clientSecurity.js's postSecurity() —
 * must never block or break the user-facing action it accompanies.
 *
 * Unlike security telemetry, this works without a signed-in user: most
 * funnel events (landing_page_view, hero_cta_clicked, signup_started)
 * happen before any Firebase user exists.
 */

import { auth } from "@/lib/firebase";
import {
  captureAttributionIfFirstTouch,
  getOrCreateAnonymousSessionId,
  getStoredAttribution,
  getStoredAttributionBundle,
} from "@/lib/analytics/attribution";
import {
  markValueMoment,
  mixpanelIdentify,
  mixpanelReset,
  mixpanelTrack,
  registerAttribution,
} from "@/lib/analytics/mixpanel";

function getDeviceInfo() {
  if (typeof navigator === "undefined") {
    return { type: "desktop", browser: "other", os: "other" };
  }

  const ua = navigator.userAgent || "";
  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile = !isTablet && /Mobi|Android|iPhone/i.test(ua);
  const type = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "other";
  if (/Edg\//.test(ua)) browser = "edge";
  else if (/Chrome\//.test(ua)) browser = "chrome";
  else if (/Firefox\//.test(ua)) browser = "firefox";
  else if (/Safari\//.test(ua)) browser = "safari";

  let os = "other";
  if (/Windows/.test(ua)) os = "windows";
  else if (/Mac OS/.test(ua)) os = "macos";
  else if (/Android/.test(ua)) os = "android";
  else if (/iPhone|iPad|iOS/.test(ua)) os = "ios";
  else if (/Linux/.test(ua)) os = "linux";

  return { type, browser, os };
}

async function postTrack(eventName, metadata) {
  if (typeof window === "undefined") {
    return;
  }
  if (window.__CLEARTILL_INTERNAL_ANALYTICS__) return;

  captureAttributionIfFirstTouch();
  const attribution = getStoredAttribution();
  const attributionBundle = getStoredAttributionBundle();
  const anonymousSessionId = getOrCreateAnonymousSessionId();

  const payload = {
    eventName,
    anonymousSessionId,
    attribution,
    attributionBundle,
    pathname: window.location.pathname,
    referrer: document.referrer || null,
    utm_source: attribution?.utm_source ?? null,
    utm_medium: attribution?.utm_medium ?? null,
    utm_campaign: attribution?.utm_campaign ?? null,
    utm_content: attribution?.utm_content ?? null,
    utm_term: attribution?.utm_term ?? null,
    fbclid: attribution?.fbclid ?? null,
    gclid: attribution?.gclid ?? null,
    device: getDeviceInfo(),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    clientTimestamp: new Date().toISOString(),
  };

  const headers = { "Content-Type": "application/json" };
  const currentUser = auth?.currentUser ?? null;

  try {
    if (currentUser) {
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }
  } catch {
    // Proceed unauthenticated if token retrieval fails.
  }

  mirrorToMixpanel(eventName, payload, currentUser);

  try {
    await fetch("/api/track", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Analytics must never disrupt the app.
  }
}

/**
 * Every event on the internal funnel also goes to Mixpanel. Mixpanel is opted
 * out until the user consents, so each of these calls is a no-op until then.
 */
function mirrorToMixpanel(eventName, payload, currentUser) {
  registerAttribution(payload.attribution);

  // Identify before the event so it lands against the user, not the anon id.
  if (eventName === "account_created" || eventName === "login") {
    mixpanelIdentify(currentUser?.uid, {
      email: currentUser?.email || undefined,
      name: currentUser?.displayName || undefined,
      signup_method: payload.metadata?.method,
    });
  }

  mixpanelTrack(eventName, {
    ...payload.metadata,
    pathname: payload.pathname,
    device_type: payload.device.type,
    device_browser: payload.device.browser,
    device_os: payload.device.os,
  });

  // ClearTill's Value Moment — the user gets their answer.
  if (eventName === "forecast_viewed") {
    markValueMoment();
  }

  // Reset last, so the logout event itself is still attributed to the user.
  if (eventName === "logout") {
    mixpanelReset();
  }
}

export function trackEvent(eventName, metadata = {}) {
  void postTrack(eventName, metadata);
}
