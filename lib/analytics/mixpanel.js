"use client";

/**
 * Mixpanel client. Mirrors the internal funnel tracker (lib/analytics/track.js)
 * rather than replacing it — every event in ANALYTICS_EVENTS goes to both the
 * Firestore-backed /admin/analytics read model and Mixpanel.
 *
 * Consent: initialised opt-out by default, so no event is sent and no storage
 * is written until the user explicitly consents (UK GDPR/PECR). Sending events
 * before consent is not recoverable without a data deletion request, so the
 * opt-out default here is load-bearing — don't flip it.
 *
 * Identity: Firebase issues an anonymous uid on first visit which is later
 * upgraded in place via linkWithPopup, so the uid survives sign-up. We identify
 * on account_created/login and reset on logout.
 */

import mixpanel from "mixpanel-browser";

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

// ClearTill's Mixpanel project uses EU data residency. Keep the environment
// override for local proxies, but default to the correct regional ingest host
// so a missing deployment variable cannot silently route events to the US.
const API_HOST = process.env.NEXT_PUBLIC_MIXPANEL_API_HOST || "https://api-eu.mixpanel.com";

const CONSENT_KEY = "ct_analytics_consent";

let initialised = false;

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

/** "granted" | "denied" | null (not yet asked) */
export function getAnalyticsConsent() {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function isEnabled() {
  return typeof window !== "undefined" && Boolean(TOKEN);
}

/**
 * Idempotent. Safe to call on every render and before consent — Mixpanel is
 * initialised opted out, so this loads the library without sending anything.
 */
export function initMixpanel() {
  if (initialised || !isEnabled()) {
    return;
  }

  // Returning users who already consented start opted IN. Calling
  // opt_in_tracking() here instead would re-fire Mixpanel's $opt_in event on
  // every single page load.
  const alreadyConsented = getAnalyticsConsent() === "granted";

  try {
    mixpanel.init(TOKEN, {
      ...(API_HOST ? { api_host: API_HOST } : {}),
      // No cookies: keeps the pre-consent footprint to nothing at all.
      persistence: "localStorage",
      opt_out_tracking_by_default: !alreadyConsented,
      opt_out_persistence_by_default: !alreadyConsented,
      // Page views are fired explicitly via landing_page_view.
      track_pageview: false,
      debug: process.env.NODE_ENV !== "production",
    });

    initialised = true;
  } catch {
    // Analytics must never disrupt the app.
  }
}

export function grantAnalyticsConsent() {
  const storage = getStorage();

  try {
    storage?.setItem(CONSENT_KEY, "granted");
  } catch {
    // Fall through — consent still applies for this page session.
  }

  if (!isEnabled()) {
    return;
  }

  initMixpanel();

  try {
    mixpanel.opt_in_tracking();
  } catch {
    // Analytics must never disrupt the app.
  }
}

export function revokeAnalyticsConsent() {
  const storage = getStorage();

  try {
    storage?.setItem(CONSENT_KEY, "denied");
  } catch {
    // Fall through — the opt-out below still applies for this page session.
  }

  if (!isEnabled()) {
    return;
  }

  try {
    // Clears Mixpanel's own persisted state as well as halting sends.
    mixpanel.opt_out_tracking();
  } catch {
    // Analytics must never disrupt the app.
  }
}

function canSend() {
  if (!isEnabled() || !initialised) {
    return false;
  }

  try {
    return !mixpanel.has_opted_out_tracking();
  } catch {
    return false;
  }
}

export function mixpanelTrack(eventName, properties = {}) {
  if (!canSend()) {
    return;
  }

  try {
    mixpanel.track(eventName, properties);
  } catch {
    // Analytics must never disrupt the app.
  }
}

/**
 * Called on account_created and login. The uid is stable across the anonymous
 * → linked upgrade, so this stitches the pre-sign-up funnel to the user.
 */
export function mixpanelIdentify(uid, properties = {}) {
  if (!uid || !canSend()) {
    return;
  }

  try {
    mixpanel.identify(uid);

    const { email, name, ...rest } = properties;

    mixpanel.people.set({
      ...(email ? { $email: email } : {}),
      ...(name ? { $name: name } : {}),
      ...rest,
    });
  } catch {
    // Analytics must never disrupt the app.
  }
}

export function mixpanelReset() {
  if (!canSend()) {
    return;
  }

  try {
    mixpanel.reset();
  } catch {
    // Analytics must never disrupt the app.
  }
}

/**
 * First-touch attribution, registered as super properties so every event
 * carries the campaign that acquired the user.
 */
export function registerAttribution(attribution) {
  if (!attribution || !canSend()) {
    return;
  }

  try {
    mixpanel.register({
      utm_source: attribution.utm_source ?? null,
      utm_medium: attribution.utm_medium ?? null,
      utm_campaign: attribution.utm_campaign ?? null,
      utm_content: attribution.utm_content ?? null,
      utm_term: attribution.utm_term ?? null,
      first_touch_referrer: attribution.referrer ?? null,
      first_touch_landing_page: attribution.landingPage ?? null,
    });
  } catch {
    // Analytics must never disrupt the app.
  }
}

/**
 * ClearTill's Value Moment: the user sees their "am I clear till payday?"
 * answer. set_once so it records the FIRST activation, not the latest one —
 * that's what time-to-activation reports need.
 */
export function markValueMoment() {
  if (!canSend()) {
    return;
  }

  try {
    mixpanel.people.set_once({ first_forecast_viewed_at: new Date().toISOString() });
    mixpanel.people.set({ activated: true });
  } catch {
    // Analytics must never disrupt the app.
  }
}
