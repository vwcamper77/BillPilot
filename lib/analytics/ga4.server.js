const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const GA_DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";

export async function sendGa4Event({ eventName, clientId, userId = null, params = {} }) {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret || !eventName) {
    const missing = [
      !measurementId ? "NEXT_PUBLIC_GA_MEASUREMENT_ID" : null,
      !apiSecret ? "GA4_API_SECRET" : null,
      !eventName ? "eventName" : null,
    ].filter(Boolean);
    console.warn("[ga4] event not sent: configuration missing", { eventName: eventName || null, missing });
    return { sent: false, reason: "not_configured", missing };
  }

  const debug = process.env.GA4_DEBUG === "true";
  const url = `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const payload = {
    client_id: clientId || stableServerClientId(userId),
    ...(userId ? { user_id: userId } : {}),
    events: [{ name: eventName, params: { engagement_time_msec: 1, ...(debug ? { debug_mode: true } : {}), ...params } }],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.info("[ga4] collect response", {
    eventName,
    measurementId,
    endpoint: GA_ENDPOINT,
    status: response.status,
    ok: response.ok,
    debug,
  });
  if (!response.ok) throw new Error(`GA4 Measurement Protocol returned ${response.status}.`);
  let validation = null;
  let validationStatus = null;
  if (debug) {
    const validationUrl = `${GA_DEBUG_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const validationResponse = await fetch(validationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, validation_behavior: "ENFORCE_RECOMMENDATIONS" }),
    });
    validationStatus = validationResponse.status;
    validation = await validationResponse.json().catch(() => null);
    console.info("[ga4] validation response", {
      eventName,
      measurementId,
      endpoint: GA_DEBUG_ENDPOINT,
      status: validationStatus,
      ok: validationResponse.ok,
      validationMessages: validation?.validationMessages || [],
    });
    if (validation?.validationMessages?.length) {
      console.warn("[ga4] validation messages", { eventName, validationMessages: validation.validationMessages });
    }
  }
  return { sent: true, debug, collectStatus: response.status, validationStatus, validation };
}

function stableServerClientId(userId) {
  const source = String(userId || "cleartill-server");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}.1`;
}

export const FOUNDING_ITEM = {
  item_id: "founding_member_90_day",
  item_name: "ClearTill 90-day founding-member offer",
  price: 5,
  quantity: 1,
};
