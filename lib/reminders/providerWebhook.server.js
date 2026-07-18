import crypto from "crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { getReminderRuntimeConfig } from "./config";

function decodeWebhookSecret(secret) {
  const encoded = String(secret || "").replace(/^whsec_/, "");
  try { return Buffer.from(encoded, "base64"); } catch { return Buffer.alloc(0); }
}
export function verifyResendWebhook({ payload, id, timestamp, signature, secret, now = Date.now(), toleranceSeconds = 300 }) {
  const timestampSeconds = Number(timestamp);
  if (!payload || !id || !signature || !secret || !Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(now / 1000) - timestampSeconds) > toleranceSeconds) return false;
  const key = decodeWebhookSecret(secret);
  if (!key.length) return false;
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return String(signature).split(/\s+/).some((entry) => {
    const [version, supplied] = entry.split(",");
    if (version !== "v1" || !supplied) return false;
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

export async function processResendWebhook({ webhookId, event }) {
  const db = getAdminDb();
  const webhookRef = db.collection("emailProviderWebhookEvents").doc(webhookId);
  const inserted = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(webhookRef);
    if (snapshot.exists) return false;
    transaction.create(webhookRef, { eventType: String(event?.type || "unknown").slice(0, 80), status: "processing", createdAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!inserted) return { ok: true, duplicate: true };

  const providerMessageId = String(event?.data?.email_id || event?.data?.emailId || "").trim();
  if (!providerMessageId) {
    await webhookRef.set({ status: "ignored", reason: "missing_email_id", processedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, ignored: true };
  }
  const deliveries = await db.collection("emailDeliveries").where("providerMessageId", "==", providerMessageId).limit(1).get();
  if (deliveries.empty) {
    await webhookRef.set({ status: "ignored", reason: "delivery_not_found", processedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, ignored: true };
  }
  const deliveryRef = deliveries.docs[0].ref;
  const delivery = deliveries.docs[0].data();
  const type = String(event.type || "");
  const patch = { providerEventType: type, providerEventAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  if (type === "email.delivered") Object.assign(patch, { status: "delivered", deliveredAt: FieldValue.serverTimestamp() });
  else if (type === "email.delivery_delayed") Object.assign(patch, { status: "deferred", deferredAt: FieldValue.serverTimestamp() });
  else if (type === "email.bounced") Object.assign(patch, { status: "bounced", bouncedAt: FieldValue.serverTimestamp() });
  else if (type === "email.complained") Object.assign(patch, { status: "complained", complainedAt: FieldValue.serverTimestamp() });
  else if (["email.failed", "email.suppressed"].includes(type)) Object.assign(patch, { status: "permanent_failure", failedAt: FieldValue.serverTimestamp() });
  else Object.assign(patch, { status: delivery.status || "sent" });

  const batch = db.batch();
  batch.set(deliveryRef, patch, { merge: true });
  if (["email.bounced", "email.complained", "email.suppressed"].includes(type) && delivery.userId) {
    batch.set(db.collection("emailSuppressions").doc(delivery.userId), {
      userId: delivery.userId,
      reason: type === "email.complained" ? "complaint" : type === "email.bounced" ? "hard_bounce" : "provider_suppression",
      provider: "resend",
      providerMessageId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(webhookRef, { status: "processed", providerMessageId, processedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { ok: true };
}

export function verifyResendWebhookRequest({ payload, headers, now = Date.now() }) {
  const config = getReminderRuntimeConfig();
  return verifyResendWebhook({
    payload,
    id: headers.get("svix-id"),
    timestamp: headers.get("svix-timestamp"),
    signature: headers.get("svix-signature"),
    secret: process.env.RESEND_WEBHOOK_SECRET,
    now,
    toleranceSeconds: config.webhookToleranceSeconds,
  });
}
