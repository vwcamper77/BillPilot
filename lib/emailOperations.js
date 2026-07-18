export const EMAIL_DELIVERY_STAGES = Object.freeze([
  "fired",
  "provider_accepted",
  "delivered",
  "delayed",
  "bounced",
  "complained",
  "failed",
]);

export function deliveryStage(status) {
  const value = String(status || "").toLowerCase();
  if (value === "claimed" || value === "processing" || value === "queued") return "fired";
  if (value === "sent") return "provider_accepted";
  if (value === "delivered") return "delivered";
  if (value === "deferred" || value === "delayed") return "delayed";
  if (value === "bounced") return "bounced";
  if (value === "complained") return "complained";
  return "failed";
}

export function summariseEmailDeliveries(deliveries = []) {
  const summary = Object.fromEntries(EMAIL_DELIVERY_STAGES.map((stage) => [stage, 0]));
  for (const delivery of deliveries) summary[deliveryStage(delivery.status)] += 1;
  return { total: deliveries.length, ...summary };
}

export function maskOperationalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function meaningfulActivityAfterDelivery(deliveryAt, activityAt) {
  const sent = deliveryAt ? new Date(deliveryAt).getTime() : 0;
  const activity = activityAt ? new Date(activityAt).getTime() : 0;
  return Boolean(sent && activity && activity > sent);
}
