import { createHash } from "node:crypto";

function hash(value) { return createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex"); }

export async function sendMetaCapiEvent({ eventName, eventId, uid, attribution = null, value = null, currency = "GBP", testEventCode = null }) {
  const pixelId = process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CONVERSIONS_API_TOKEN;
  if (!pixelId || !token || !eventName || !eventId) return { sent: false, reason: "not_configured" };
  const touch = attribution?.lastTouch || attribution?.firstTouch || {};
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      user_data: {
        ...(uid ? { external_id: [hash(uid)] } : {}),
        ...(touch.fbc ? { fbc: touch.fbc } : {}),
        ...(touch.fbp ? { fbp: touch.fbp } : {}),
      },
      ...(value !== null ? { custom_data: { value, currency } } : {}),
    }],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
  const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Meta Conversions API returned ${response.status}.`);
  return { sent: true };
}
