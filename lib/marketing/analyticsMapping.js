"use strict";

const FUNNEL_MAPPING = Object.freeze({
  social_link_clicked: { existingEvent: "landing_page_view", capture: "Landing attribution supplies the social click context without adding a duplicate browser event." },
  landing_cta_clicked: { existingEvent: "try_now_clicked", capture: "Use existing CTA events such as try_now_clicked or hero_cta_clicked at the actual surface." },
  preview_started: { existingEvent: "preview_started", capture: "Already emitted server-side when preview creation succeeds." },
  first_position_saved: { existingEvent: "first_clear_result_viewed", capture: "Existing value-moment event; do not introduce a second equivalent event." },
  balance_updated: { existingEvent: "balance_updated_during_preview", capture: "Use balance_updated where the legacy funnel already emits it, otherwise the preview-specific event." },
  return_visit: { existingEvent: "login", capture: "Derive return visits analytically from repeat sessions or login; no new event is required." },
  plan_selected: { existingEvent: "upgrade_offer_viewed", capture: "Use plan metadata on the existing checkout or offer event where privacy rules permit." },
  checkout_started: { existingEvent: "checkout_started", capture: "Already allowlisted; trial_checkout_started remains valid for the card-trial flow." },
  purchase_completed: { existingEvent: "first_invoice_paid", capture: "Only verified webhook outcomes count; subscription_started or renewal_invoice_paid distinguish lifecycle stages." },
});

const CAMPAIGN_DIMENSIONS = Object.freeze(["utm_source", "utm_medium", "utm_campaign", "utm_content", "experiment_id", "content_id", "landing_variant", "access_type"]);

function mapMarketingEvent(name) {
  const mapping = FUNNEL_MAPPING[name];
  if (!mapping) throw new Error(`Unsupported marketing funnel event: ${name}.`);
  return mapping;
}

module.exports = { CAMPAIGN_DIMENSIONS, FUNNEL_MAPPING, mapMarketingEvent };
