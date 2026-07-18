import crypto from "crypto";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";
import { calculateBillSchedule } from "@/lib/billMath";
import {
  claimEmailDelivery,
  emailFailureStatus,
  markEmailDelivery,
  sendResendEmail,
} from "@/lib/email";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { getReminderRuntimeConfig } from "./config";
import { normaliseReminderPreferences } from "./preferences";
import { adaptiveReminderState, buildNotificationIdempotencyKey, decideReminderNotification, eligibleTomorrowBills, NOTIFICATION_TYPES, ROUTINE_TYPES } from "./policy";
import { localDateIso, localTomorrowIso } from "./timezone";
import { buildReminderEmail } from "./templates";
import { deriveCommercialLifecycle, syncCommercialLifecycle } from "./lifecycle.server";
import {
  cancelPendingNotificationTypes,
  claimNotificationEvent,
  completeNotificationEvent,
  failNotificationEvent,
  listProcessableEvents,
  queueNotificationEvent,
} from "./store.server";

function date(value) {
  if (!value) return null;
  const parsed = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serialiseDates(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, child]) => [key, child?.toDate ? child.toDate().toISOString() : child]));
}

function cohortForUid(uid, guidedPercent) {
  const bucket = crypto.createHash("sha256").update(`reminder-cohort:${uid}`).digest().readUInt32BE(0) % 100;
  return bucket < guidedPercent ? "GUIDED" : "LIGHT";
}

async function loadReminderContext(uid, now, config) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const [
    userSnapshot, subscriptionSnapshot, previewSnapshot, preferencesSnapshot,
    balanceSnapshot, billsSnapshot, lifecycleSnapshot, stateSnapshot, suppressionSnapshot,
    entitlement, authUser,
  ] = await Promise.all([
    userRef.get(),
    userRef.collection("billing").doc("subscription").get(),
    userRef.collection("access").doc("preview").get(),
    userRef.collection("settings").doc("emailPreferences").get(),
    userRef.collection("settings").doc("balance").get(),
    userRef.collection("bills").where("active", "==", true).get(),
    userRef.collection("notifications").doc("lifecycle").get(),
    userRef.collection("notifications").doc("state").get(),
    db.collection("emailSuppressions").doc(uid).get(),
    resolveEntitlementForUid(uid),
    getAdminAuth().getUser(uid).catch(() => null),
  ]);
  const user = userSnapshot.exists ? userSnapshot.data() : {};
  const subscription = subscriptionSnapshot.exists ? subscriptionSnapshot.data() : {};
  const preview = previewSnapshot.exists ? previewSnapshot.data() : {};
  const storedLifecycle = lifecycleSnapshot.exists ? lifecycleSnapshot.data() : {};
  const lifecycle = deriveCommercialLifecycle({
    uid,
    existing: serialiseDates(storedLifecycle),
    entitlement,
    subscription,
    preview,
    now,
    cohort: cohortForUid(uid, config.guidedCohortPercent),
  });
  const preferences = normaliseReminderPreferences(preferencesSnapshot.exists ? preferencesSnapshot.data() : {}, { defaultStaleThresholdHours: config.staleThresholdHours });
  const balance = balanceSnapshot.exists ? balanceSnapshot.data() : {};
  const localToday = localDateIso(now, preferences.timezone);
  const bills = billsSnapshot.docs.map((doc) => {
    const stored = { id: doc.id, ...doc.data() };
    if (stored.nextDueDate) return stored;
    const schedule = calculateBillSchedule(stored.dueDay, 1, stored.paidThroughDate || null, localToday);
    return { ...stored, ...schedule };
  });
  return {
    uid,
    user: { ...user, email: authUser?.email || user.email || subscription.customerEmail || "", displayName: authUser?.displayName || user.displayName || "" },
    emailVerified: Boolean(authUser?.emailVerified),
    subscription,
    preview,
    entitlement,
    lifecycle,
    preferences,
    balanceUpdatedAt: date(balance.snapshotEnteredAt || balance.updatedAt),
    bills,
    state: { ...(stateSnapshot.exists ? stateSnapshot.data() : {}), suppressed: suppressionSnapshot.exists },
  };
}

async function applyAdaptiveState(context, now, config) {
  const { state, preferences, lifecycle, uid } = context;
  const statePatch = adaptiveReminderState({ state, preferences, lifecycle, now, inactivityPauseDays: config.inactivityPauseDays });
  Object.assign(state, statePatch);
  if (Object.keys(statePatch).length) {
    await getAdminDb().collection("users").doc(uid).collection("notifications").doc("state").set({ ...statePatch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return context;
}

function endingEventDue(lifecycle, now, config) {
  if (lifecycle.entryPath !== "FREE_TRIAL" || lifecycle.entitlementState !== "TRIAL_ACTIVE" || !lifecycle.trialEndsAt) return false;
  const remaining = new Date(lifecycle.trialEndsAt).getTime() - now.getTime();
  return remaining > 0 && remaining <= config.trialEndingHours * 3600000;
}

function eventStillEligible(event, context, now, config) {
  if (!context.emailVerified || !context.user.email || context.state.suppressed) return { ok: false, reason: "email_unverified_or_suppressed" };
  const { lifecycle, preferences } = context;
  if (ROUTINE_TYPES.has(event.type) && !config.routineEnabled) return { ok: false, reason: "routine_delivery_disabled" };
  if (event.type === NOTIFICATION_TYPES.PREFERENCES_CHANGED) return { ok: true };
  if (event.type === NOTIFICATION_TYPES.TRIAL_WELCOME) return { ok: lifecycle.entryPath === "FREE_TRIAL" && lifecycle.entitlementState === "TRIAL_ACTIVE", reason: "trial_state_changed" };
  if (event.type === NOTIFICATION_TYPES.DIRECT_PAID_WELCOME) return { ok: lifecycle.entryPath === "DIRECT_PAID" && lifecycle.entitlementState === "PAID_ACTIVE", reason: "paid_state_changed" };
  if (event.type === NOTIFICATION_TYPES.TRIAL_ENDING_SOON) return { ok: endingEventDue(lifecycle, now, config), reason: "trial_no_longer_ending" };
  if (event.type === NOTIFICATION_TYPES.TRIAL_CONVERTED_TO_PAID) return { ok: lifecycle.entryPath === "FREE_TRIAL" && lifecycle.entitlementState === "PAID_ACTIVE", reason: "conversion_state_changed" };
  if (event.type === NOTIFICATION_TYPES.TRIAL_EXPIRED) return { ok: lifecycle.entryPath === "FREE_TRIAL" && lifecycle.entitlementState === "TRIAL_EXPIRED", reason: "expiry_state_changed" };
  if (!["TRIAL_ACTIVE", "PAID_ACTIVE"].includes(lifecycle.entitlementState)) return { ok: false, reason: "routine_entitlement_inactive" };
  if (preferences.balanceReminderMode === "OFF") return { ok: false, reason: "reminders_off" };
  if ([NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE, NOTIFICATION_TYPES.PAID_SETUP_NUDGE].includes(event.type) && lifecycle.firstValueActionAt) return { ok: false, reason: "first_value_completed" };
  if ([NOTIFICATION_TYPES.BILL_DUE_TOMORROW, NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE].includes(event.type)) {
    const due = eligibleTomorrowBills(context.bills, localTomorrowIso(now, preferences.timezone));
    if (!event.relevantEntityIds.every((id) => due.some((bill) => bill.id === id))) return { ok: false, reason: "bill_changed" };
  }
  return { ok: true };
}

async function processEvent(uid, queuedEvent, now, config) {
  if (date(queuedEvent.scheduledAtUtc)?.getTime() > now.getTime()) return { status: "scheduled" };
  if (date(queuedEvent.nextAttemptAt)?.getTime() > now.getTime()) return { status: "scheduled", reason: "retry_not_due" };
  const claim = await claimNotificationEvent(uid, queuedEvent.id, now);
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };
  const event = claim.event;
  const context = await loadReminderContext(uid, now, config);
  const eligible = eventStillEligible(event, context, now, config);
  if (!eligible.ok) {
    await failNotificationEvent(uid, event, eligible.reason, { cancel: true });
    await trackServerAnalyticsEvent("notification_decision", { uid, source: "suppressed", notificationType: event.type, entryPath: context.lifecycle.entryPath });
    return { status: "cancelled", reason: eligible.reason };
  }
  let message;
  try {
    const relevantBills = context.bills.filter((bill) => event.relevantEntityIds?.includes(bill.id));
    message = buildReminderEmail({ event, lifecycle: context.lifecycle, preferences: context.preferences, user: context.user, balanceUpdatedAt: context.balanceUpdatedAt, bills: relevantBills, now });
  } catch (error) {
    await failNotificationEvent(uid, event, error.message, { cancel: true });
    return { status: "cancelled", reason: "template_terms_incomplete" };
  }
  const delivery = await claimEmailDelivery({ userId: uid, type: event.type, period: event.id, transactional: !ROUTINE_TYPES.has(event.type) });
  if (!delivery.ok) {
    if (delivery.reason === "duplicate") await completeNotificationEvent(uid, event, { duplicateDelivery: true, templateId: message.templateId, templateVersion: message.templateVersion });
    else await failNotificationEvent(uid, event, delivery.reason);
    return { status: delivery.reason === "duplicate" ? "sent" : "failed", reason: delivery.reason };
  }
  try {
    const response = await sendResendEmail({
      to: context.user.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "X-ClearTill-Email-Type": event.type, "X-ClearTill-Idempotency-Key": delivery.idempotencyKey },
    });
    if (response.skipped) throw new Error(response.error || "email_not_configured");
    await markEmailDelivery(delivery.ref, {
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      providerMessageId: response.providerMessageId || null,
      notificationEventId: event.id,
      templateId: message.templateId,
      templateVersion: message.templateVersion,
      commercialEntryPath: context.lifecycle.entryPath,
    }, { claimToken: delivery.claimToken });
    await completeNotificationEvent(uid, event, { providerMessageId: response.providerMessageId || null, templateId: message.templateId, templateVersion: message.templateVersion });
    await trackServerAnalyticsEvent("notification_delivery", { uid, source: "sent", notificationType: event.type, entryPath: context.lifecycle.entryPath });
    return { status: "sent", type: event.type };
  } catch (error) {
    await markEmailDelivery(delivery.ref, { status: error.permanent ? "permanent_failure" : emailFailureStatus(delivery.attempts), reason: String(error.message || "send_failed").slice(0, 120) }, { claimToken: delivery.claimToken });
    await failNotificationEvent(uid, event, error.message, { permanent: Boolean(error.permanent), now });
    return { status: "failed", reason: "provider_send_failed" };
  }
}

async function cancelForTransition(uid, eventType) {
  if (eventType === NOTIFICATION_TYPES.TRIAL_CONVERTED_TO_PAID) {
    return cancelPendingNotificationTypes(uid, [NOTIFICATION_TYPES.TRIAL_ENDING_SOON, NOTIFICATION_TYPES.TRIAL_EXPIRED, NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE], "trial_converted");
  }
  if (eventType === NOTIFICATION_TYPES.TRIAL_EXPIRED) {
    return cancelPendingNotificationTypes(uid, [NOTIFICATION_TYPES.BALANCE_STALE, NOTIFICATION_TYPES.BILL_DUE_TOMORROW, NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE, NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE], "trial_expired");
  }
  return 0;
}

async function cancelForInactiveState(uid, lifecycle) {
  if (!["TRIAL_EXPIRED", "PAST_DUE", "CANCELLED", "INACTIVE"].includes(lifecycle.entitlementState)) return 0;
  return cancelPendingNotificationTypes(uid, [
    NOTIFICATION_TYPES.TRIAL_ENDING_SOON,
    NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE,
    NOTIFICATION_TYPES.PAID_SETUP_NUDGE,
    NOTIFICATION_TYPES.BALANCE_STALE,
    NOTIFICATION_TYPES.BILL_DUE_TOMORROW,
    NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE,
    NOTIFICATION_TYPES.BALANCE_REMINDERS_PAUSED,
  ], `entitlement_${lifecycle.entitlementState.toLowerCase()}`);
}

export async function runReminderForUser(uid, { now = new Date(), onlyLifecycle = false } = {}) {
  const config = getReminderRuntimeConfig();
  if (!config.enabled || config.emergencyDisabled) return { status: "disabled" };
  const initial = await loadReminderContext(uid, now, config);
  const sync = await syncCommercialLifecycle({ uid, entitlement: initial.entitlement, subscription: initial.subscription, preview: initial.preview, now, cohort: initial.lifecycle.cohort });
  const context = await applyAdaptiveState({ ...initial, lifecycle: sync.current }, now, config);
  const suppressHistoricalWelcome = config.lifecycleStartAt
    && [NOTIFICATION_TYPES.TRIAL_WELCOME, NOTIFICATION_TYPES.DIRECT_PAID_WELCOME].includes(sync.eventType)
    && date(sync.current.reminderLifecycleStartedAt)?.getTime() < config.lifecycleStartAt.getTime();
  const transitionEvent = suppressHistoricalWelcome ? null : sync.eventType;
  await cancelForTransition(uid, transitionEvent);
  await cancelForInactiveState(uid, sync.current);

  const queued = await listProcessableEvents(uid);
  const processed = [];
  for (const event of queued) {
    if (onlyLifecycle && ROUTINE_TYPES.has(event.type)) continue;
    processed.push(await processEvent(uid, event, now, config));
  }

  const lifecycleEvent = transitionEvent || (endingEventDue(context.lifecycle, now, config) ? NOTIFICATION_TYPES.TRIAL_ENDING_SOON : null);
  const decision = decideReminderNotification({
    userId: uid,
    lifecycle: context.lifecycle,
    preferences: context.preferences,
    state: context.state,
    balanceUpdatedAt: context.balanceUpdatedAt,
    bills: context.bills,
    lifecycleEvent,
    now,
    config: { ...config, routineEnabled: config.routineEnabled && !onlyLifecycle },
  });
  if (!decision.eligible) return { status: "skipped", reasons: decision.reasons, processed };
  if (onlyLifecycle && decision.category !== "lifecycle") return { status: "skipped", reasons: ["lifecycle_only"], processed };
  if (decision.category === "routine") {
    const scheduledMs = new Date(decision.scheduledAtUtc).getTime();
    const lag = now.getTime() - scheduledMs;
    if (lag < 0 || lag > config.schedulerLookbackMinutes * 60000) return { status: "scheduled", scheduledAt: decision.scheduledAtUtc, processed };
  }
  const queuedResult = await queueNotificationEvent({ uid, decision, now, routineCapHours: config.routineCapHours });
  await trackServerAnalyticsEvent("notification_decision", { uid, source: queuedResult.queued ? "queued" : queuedResult.reason, notificationType: decision.notificationType, entryPath: context.lifecycle.entryPath });
  if (!queuedResult.queued) return { status: "skipped", reason: queuedResult.reason, processed };
  const sent = await processEvent(uid, { id: queuedResult.id, scheduledAtUtc: new Date(decision.scheduledAtUtc) }, now, config);
  return { ...sent, processed };
}

export async function runReminderScheduler({ now = new Date(), requestedUid = "" } = {}) {
  const db = getAdminDb();
  const users = requestedUid ? [await db.collection("users").doc(requestedUid).get()] : (await db.collection("users").get()).docs;
  const summary = { ok: true, processedUsers: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0, disabled: 0 };
  for (const user of users) {
    if (!user.exists) continue;
    summary.processedUsers += 1;
    try {
      const result = await runReminderForUser(user.id, { now });
      summary[result.status] = Number(summary[result.status] || 0) + 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[reminder-scheduler] user failed", { uid: user.id, code: error?.code || "unknown" });
    }
  }
  return summary;
}

export async function queuePreferenceChangedNotification(uid, auditVersion, { now = new Date() } = {}) {
  const config = getReminderRuntimeConfig();
  if (!config.enabled || config.emergencyDisabled) return { status: "disabled" };
  const context = await loadReminderContext(uid, now, config);
  const idempotencyKey = buildNotificationIdempotencyKey({ userId: uid, type: NOTIFICATION_TYPES.PREFERENCES_CHANGED, sourceVersion: auditVersion, localDate: localDateIso(now, context.preferences.timezone) });
  const decision = {
    eligible: true,
    notificationType: NOTIFICATION_TYPES.PREFERENCES_CHANGED,
    reasons: ["authenticated_preferences_changed"],
    relevantEntityIds: [],
    commercialEntryPath: context.lifecycle.entryPath,
    entitlementState: context.lifecycle.entitlementState,
    conversionType: context.lifecycle.conversionType,
    sourceVersion: auditVersion,
    scheduledLocalDate: localDateIso(now, context.preferences.timezone),
    scheduledLocalTime: "immediate",
    scheduledAtUtc: now.toISOString(),
    privacyMode: context.preferences.privacyMode,
    policyVersion: "2026-07-18.v1",
    category: "lifecycle",
    idempotencyKey,
  };
  const queued = await queueNotificationEvent({ uid, decision, now, routineCapHours: config.routineCapHours });
  if (!queued.queued) return { status: "skipped", reason: queued.reason };
  return processEvent(uid, { id: queued.id, scheduledAtUtc: now }, now, config);
}
