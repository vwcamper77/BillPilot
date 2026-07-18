export const LEAD_MAGNET_CONSENT_VERSION = "cash-position-marketing-v1-2026-07-18";
export const LEAD_MAGNET_CONSENT_TEXT = "Email me occasional ClearTill money-planning tips and product updates. I can unsubscribe at any time. This is optional.";
export const LEAD_MAGNET_EXPERIMENT_VARIANT = "cash_position_exit_v1";

export const LEAD_MAGNET_STORAGE_KEYS = {
  dismissedAt: "ct_cash_position_offer_dismissed_at",
  completed: "ct_cash_position_offer_completed",
  shownThisSession: "ct_cash_position_offer_shown",
  primaryCtaUsed: "ct_primary_cta_used",
  previewPending: "ct_lead_magnet_preview_pending",
};

export const LEAD_MAGNET_TIMING = {
  desktopEligibleMs: 20_000,
  mobileEligibleMs: 45_000,
  dismissalMs: 14 * 24 * 60 * 60 * 1000,
  mobileScrollRatio: 0.6,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXCLUDED_ROUTE_PREFIXES = [
  "/dashboard",
  "/account",
  "/signin",
  "/start",
  "/access",
  "/trial",
  "/checkout",
  "/billing",
  "/admin",
  "/privacy",
  "/terms",
  "/security",
  "/unsubscribe",
];

export function normaliseLeadEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function isLeadMagnetExcludedRoute(pathname) {
  const route = String(pathname || "/").toLowerCase();
  return EXCLUDED_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function isValidGoogleSheetCopyUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:"
      && url.hostname === "docs.google.com"
      && /\/spreadsheets\/d\/[^/]+\/copy\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isDismissalSuppressed(value, now = Date.now()) {
  const dismissedAt = Number(value);
  return Number.isFinite(dismissedAt)
    && dismissedAt > 0
    && now - dismissedAt < LEAD_MAGNET_TIMING.dismissalMs;
}

export function sanitiseLeadAttribution(value) {
  const source = value && typeof value === "object" ? value : {};
  const clean = (input, max) => {
    const text = typeof input === "string" ? input.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
    return text ? text.slice(0, max) : null;
  };
  return {
    sourceRoute: clean(source.sourceRoute, 512) || "/",
    referrer: clean(source.referrer, 512),
    utmSource: clean(source.utmSource, 128),
    utmMedium: clean(source.utmMedium, 128),
    utmCampaign: clean(source.utmCampaign, 128),
    utmContent: clean(source.utmContent, 128),
    utmTerm: clean(source.utmTerm, 128),
  };
}
