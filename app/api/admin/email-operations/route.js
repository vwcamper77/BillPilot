import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { getReminderRuntimeConfig } from "@/lib/reminders/config";
import { maskOperationalEmail, meaningfulActivityAfterDelivery, summariseEmailDeliveries } from "@/lib/emailOperations";

export const runtime = "nodejs";

const DELIVERY_LIMIT = 500;
const SUPPRESSION_LIMIT = 200;

export async function GET(request) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const { searchParams } = new URL(request.url);
    const requestedRange = Number(searchParams.get("rangeDays") || 7);
    const rangeDays = [1, 7, 30, 90].includes(requestedRange) ? requestedRange : 7;
    const rangeStart = new Date(Date.now() - rangeDays * 86400000);
    const db = getAdminDb();

    const [deliverySnapshot, suppressionSnapshot] = await Promise.all([
      db.collection("emailDeliveries")
        .where("updatedAt", ">=", rangeStart)
        .orderBy("updatedAt", "desc")
        .limit(DELIVERY_LIMIT)
        .get(),
      db.collection("emailSuppressions").limit(SUPPRESSION_LIMIT).get(),
    ]);

    const rawDeliveries = deliverySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const userIds = [...new Set(rawDeliveries.map((delivery) => delivery.userId).filter(Boolean))];
    const [stateByUid, emailByUid] = await Promise.all([
      loadReminderStates(db, userIds),
      loadMaskedEmails(userIds),
    ]);

    const deliveries = rawDeliveries.map((delivery) => serializeDelivery(
      delivery,
      stateByUid.get(delivery.userId),
      emailByUid.get(delivery.userId),
    ));
    const suppressions = suppressionSnapshot.docs
      .map((doc) => serializeSuppression(doc.id, doc.data(), emailByUid.get(doc.data()?.userId || doc.id)))
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 100);
    const config = getReminderRuntimeConfig();
    const response = NextResponse.json({
      ok: true,
      rangeDays,
      generatedAt: new Date().toISOString(),
      truncated: deliverySnapshot.size === DELIVERY_LIMIT,
      summary: summariseEmailDeliveries(deliveries),
      configuration: {
        reminderEmailsEnabled: config.enabled,
        routineEmailsEnabled: config.routineEnabled,
        emergencyDisabled: config.emergencyDisabled,
        providerConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS),
        webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
        schedulerConfigured: Boolean(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET),
        openTrackingUsedForDecisions: false,
      },
      deliveries,
      suppressions,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (["auth/missing-id-token", "auth/invalid-id-token", "auth/id-token-expired"].includes(error?.code)) {
      return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    }
    if (error?.code === "auth/forbidden") {
      return NextResponse.json({ ok: false, error: "You are not allowed to view email operations." }, { status: 403 });
    }
    console.error("[admin-email-operations] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ ok: false, error: "Could not load email operations right now." }, { status: 500 });
  }
}

async function loadReminderStates(db, userIds) {
  if (!userIds.length) return new Map();
  const snapshots = await db.getAll(...userIds.map((uid) => db.collection("users").doc(uid).collection("notifications").doc("state")));
  return new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.ref.parent.parent.id, snapshot.data()]));
}

async function loadMaskedEmails(userIds) {
  const result = new Map();
  const auth = getAdminAuth();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const chunk = userIds.slice(offset, offset + 100);
    const response = await auth.getUsers(chunk.map((uid) => ({ uid })));
    for (const user of response.users) result.set(user.uid, maskOperationalEmail(user.email));
  }
  return result;
}

function serializeDelivery(delivery, state = {}, maskedEmail = null) {
  const sentAt = serializeTimestamp(delivery.sentAt);
  const activityAt = serializeTimestamp(state?.lastMeaningfulActivityAt);
  return {
    id: delivery.id,
    userId: delivery.userId || null,
    recipient: maskedEmail,
    type: delivery.type || "unknown",
    status: delivery.status || "unknown",
    transactional: delivery.transactional === true,
    attempts: Number(delivery.attempts || 0),
    providerMessageId: delivery.providerMessageId || null,
    providerEventType: delivery.providerEventType || null,
    notificationEventId: delivery.notificationEventId || null,
    templateId: delivery.templateId || null,
    templateVersion: delivery.templateVersion || null,
    commercialEntryPath: delivery.commercialEntryPath || null,
    createdAt: serializeTimestamp(delivery.createdAt),
    firedAt: serializeTimestamp(delivery.lastAttemptAt || delivery.createdAt),
    sentAt,
    deliveredAt: serializeTimestamp(delivery.deliveredAt),
    deferredAt: serializeTimestamp(delivery.deferredAt),
    bouncedAt: serializeTimestamp(delivery.bouncedAt),
    complainedAt: serializeTimestamp(delivery.complainedAt),
    failedAt: serializeTimestamp(delivery.failedAt),
    updatedAt: serializeTimestamp(delivery.updatedAt),
    failureReason: delivery.reason || delivery.failureReason || null,
    activityAfterSend: meaningfulActivityAfterDelivery(sentAt, activityAt),
    activityAt,
    activityReason: state?.lastActivityReason || null,
  };
}

function serializeSuppression(id, data = {}, maskedEmail = null) {
  return {
    id,
    userId: data.userId || null,
    recipient: maskedEmail,
    reason: data.reason || "suppressed",
    provider: data.provider || null,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function serializeTimestamp(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
