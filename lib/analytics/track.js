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
} from "@/lib/analytics/attribution";

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

  captureAttributionIfFirstTouch();
  const attribution = getStoredAttribution();
  const anonymousSessionId = getOrCreateAnonymousSessionId();

  const payload = {
    eventName,
    anonymousSessionId,
    attribution,
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

  try {
    const currentUser = auth?.currentUser;
    if (currentUser) {
      headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
    }
  } catch {
    // Proceed unauthenticated if token retrieval fails.
  }

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

export function trackEvent(eventName, metadata = {}) {
  void postTrack(eventName, metadata);
}
