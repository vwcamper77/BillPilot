const LIMITS = { utm_source: 128, utm_medium: 128, utm_campaign: 128, utm_content: 128, utm_term: 128, fbclid: 256, fbc: 256, fbp: 256, referrer: 512, landingPage: 512, anonymousSessionId: 128, firstSeenAt: 64, capturedAt: 64 };

function clean(value, max) {
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return result ? result.slice(0, max) : null;
}

export function sanitizeTouch(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const [key, max] of Object.entries(LIMITS)) result[key] = clean(value[key], max);
  return result;
}

export function sanitizeAttributionBundle(value) {
  if (!value || typeof value !== "object") return null;
  const firstTouch = sanitizeTouch(value.firstTouch);
  const lastTouch = sanitizeTouch(value.lastTouch);
  return firstTouch || lastTouch ? { firstTouch: firstTouch || lastTouch, lastTouch: lastTouch || firstTouch } : null;
}

export function attributionMetadata(bundle) {
  const safe = sanitizeAttributionBundle(bundle);
  const id = safe?.firstTouch?.anonymousSessionId || "";
  const first = safe?.firstTouch || {};
  const last = safe?.lastTouch || {};
  return {
    attribution_id: id.slice(0, 128),
    at_first_source: first.utm_source || "", at_first_medium: first.utm_medium || "", at_first_campaign: first.utm_campaign || "",
    at_last_source: last.utm_source || "", at_last_medium: last.utm_medium || "", at_last_campaign: last.utm_campaign || "",
    at_fbc: last.fbc || first.fbc || "", at_fbp: last.fbp || first.fbp || "",
  };
}

export function attributionFromStripeMetadata(metadata = {}) {
  return sanitizeAttributionBundle({
    firstTouch: { anonymousSessionId: metadata.attribution_id, utm_source: metadata.at_first_source, utm_medium: metadata.at_first_medium, utm_campaign: metadata.at_first_campaign },
    lastTouch: { anonymousSessionId: metadata.attribution_id, utm_source: metadata.at_last_source, utm_medium: metadata.at_last_medium, utm_campaign: metadata.at_last_campaign, fbc: metadata.at_fbc, fbp: metadata.at_fbp },
  });
}
