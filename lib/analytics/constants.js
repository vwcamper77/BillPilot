// Shared allowlist for the internal analytics/funnel tracking system.
// Used by both the client tracker (lib/analytics/track.js) and the
// server write route (app/api/track/route.js) so they can never drift.

export const ANALYTICS_EVENTS = [
  "landing_page_view",
  "hero_cta_clicked",
  "signup_started",
  "account_created",
  "onboarding_started",
  "payday_added",
  "bill_input_started",
  "bill_reviewed",
  "bill_added",
  "forecast_viewed",
  "paywall_viewed",
  "checkout_started",
  "checkout_completed",
  "subscription_created",
  "subscription_cancelled",
  "login",
  "logout",
];

// The subsequence of ANALYTICS_EVENTS that represents linear progress
// toward payment. Used to render the funnel section in /admin/analytics.
export const FUNNEL_STAGES = [
  "landing_page_view",
  "hero_cta_clicked",
  "signup_started",
  "account_created",
  "onboarding_started",
  "bill_added",
  "forecast_viewed",
  "paywall_viewed",
  "checkout_started",
  "checkout_completed",
];

// Events that represent forward progress and are worth recording as the
// customer's current drop-off stage on their customers/{uid} record.
export const DROP_OFF_STAGE_EVENTS = new Set([
  "onboarding_started",
  "bill_added",
  "forecast_viewed",
  "paywall_viewed",
  "checkout_started",
]);
