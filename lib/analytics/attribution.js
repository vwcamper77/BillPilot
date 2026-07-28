"use client";

const ANON_ID_KEY = "ct_anon_id";
const FIRST_KEY = "ct_attribution_first";
const LAST_KEY = "ct_attribution_last";
const LEGACY_KEY = "ct_attribution";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const CAMPAIGN_KEYS = ["experiment_id", "content_id", "creative_id", "landing_variant", "access_type"];

function storage() { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } }
function clean(value, max = 128) {
  const text = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  return text ? text.slice(0, max) : null;
}
function cookie(name) {
  if (typeof document === "undefined") return null;
  return clean(decodeURIComponent(document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""), 256);
}
function read(key) {
  try {
    const value = JSON.parse(storage()?.getItem(key) || "null");
    if (!value || Date.now() - Date.parse(value.capturedAt || value.firstSeenAt) > TTL_MS) return null;
    return value;
  } catch { return null; }
}

export function getOrCreateAnonymousSessionId() {
  const store = storage();
  if (!store) return null;
  const existing = clean(store.getItem(ANON_ID_KEY), 128);
  if (existing) return existing;
  const id = crypto?.randomUUID?.() || `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  store.setItem(ANON_ID_KEY, id);
  return id;
}

function currentTouch() {
  const params = new URLSearchParams(window.location.search);
  const capturedAt = new Date().toISOString();
  const result = {
    anonymousSessionId: getOrCreateAnonymousSessionId(),
    referrer: clean(document.referrer, 512),
    landingPage: clean(window.location.pathname, 512),
    firstSeenAt: capturedAt,
    capturedAt,
    fbclid: clean(params.get("fbclid"), 256),
    fbc: cookie("_fbc"),
    fbp: cookie("_fbp"),
  };
  for (const key of UTM_KEYS) result[key] = clean(params.get(key));
  for (const key of CAMPAIGN_KEYS) result[key] = clean(params.get(key));
  return result;
}

function hasCampaignSignal(bundle) {
  return [...UTM_KEYS, ...CAMPAIGN_KEYS].some((key) => bundle[key]) || bundle.fbclid || bundle.fbc;
}

export function captureAttributionIfFirstTouch() {
  const store = storage();
  if (!store) return { isFirstTouch: false, bundle: null };
  let first = read(FIRST_KEY) || read(LEGACY_KEY);
  const touch = currentTouch();
  const isFirstTouch = !first;
  if (!first) {
    first = touch;
    store.setItem(FIRST_KEY, JSON.stringify(first));
  }
  if (!read(LAST_KEY) || hasCampaignSignal(touch)) store.setItem(LAST_KEY, JSON.stringify(touch));
  store.removeItem(LEGACY_KEY);
  return { isFirstTouch, bundle: first };
}

export function getStoredAttribution() { return read(FIRST_KEY) || read(LEGACY_KEY); }
export function getStoredAttributionBundle() {
  captureAttributionIfFirstTouch();
  return { firstTouch: read(FIRST_KEY), lastTouch: read(LAST_KEY) || read(FIRST_KEY) };
}
