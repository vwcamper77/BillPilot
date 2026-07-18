import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { notificationEventId, ROUTINE_TYPES } from "./policy";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return new Date(value).getTime() || 0;
}

function eventRef(uid, id) {
  return getAdminDb().collection("users").doc(uid).collection("notificationEvents").doc(id);
}

function stateRef(uid) {
  return getAdminDb().collection("users").doc(uid).collection("notifications").doc("state");
}

export function routineWindowDecision(state = {}, now = new Date(), routineCapHours = 24) {
  if (state.activeRoutineEventId) return { ok: false, reason: "routine_in_progress" };
  if (toMillis(state.lastRoutineSentAt) > now.getTime() - routineCapHours * 3600000) return { ok: false, reason: "routine_cap" };
  return { ok: true };
}

export async function queueNotificationEvent({ uid, decision, now = new Date(), routineCapHours = 24 }) {
  const id = notificationEventId(decision.idempotencyKey);
  const ref = eventRef(uid, id);
  const state = stateRef(uid);
  return getAdminDb().runTransaction(async (transaction) => {
    const [eventSnapshot, stateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(state)]);
    if (eventSnapshot.exists) return { queued: false, reason: "duplicate", id, ref };
    const currentState = stateSnapshot.exists ? stateSnapshot.data() : {};
    const routine = ROUTINE_TYPES.has(decision.notificationType);
    if (routine) {
      const window = routineWindowDecision(currentState, now, routineCapHours);
      if (!window.ok) return { queued: false, reason: window.reason, id, ref };
    }
    transaction.create(ref, {
      userId: uid,
      type: decision.notificationType,
      commercialEntryPath: decision.commercialEntryPath,
      entitlementState: decision.entitlementState,
      conversionType: decision.conversionType || null,
      sourceVersion: decision.sourceVersion,
      relevantEntityIds: decision.relevantEntityIds || [],
      tomorrowIso: decision.tomorrowIso || null,
      scheduledAtUtc: new Date(decision.scheduledAtUtc),
      scheduledLocalDate: decision.scheduledLocalDate,
      scheduledLocalTime: decision.scheduledLocalTime,
      category: decision.category,
      privacyMode: decision.privacyMode,
      status: "queued",
      policyVersion: decision.policyVersion,
      decisionReasons: decision.reasons,
      idempotencyKey: decision.idempotencyKey,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      queuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (routine) transaction.set(state, { activeRoutineEventId: id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { queued: true, id, ref };
  });
}

export async function claimNotificationEvent(uid, id, now = new Date()) {
  const ref = eventRef(uid, id);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["queued", "failed", "processing"].includes(snapshot.data().status)) return { claimed: false, reason: "not_queueable" };
    const event = snapshot.data();
    if (event.status === "processing" && toMillis(event.processingStartedAt) > now.getTime() - 15 * 60000) return { claimed: false, reason: "in_progress" };
    if (event.status === "failed" && Number(event.attempts || 0) >= 5) return { claimed: false, reason: "max_attempts" };
    if (event.status === "failed" && toMillis(event.nextAttemptAt) > now.getTime()) return { claimed: false, reason: "retry_not_due" };
    transaction.update(ref, { status: "processing", attempts: FieldValue.increment(1), processingStartedAt: now, updatedAt: FieldValue.serverTimestamp() });
    return { claimed: true, ref, event: { id, ...event, attempts: Number(event.attempts || 0) + 1 } };
  });
}

export async function completeNotificationEvent(uid, event, patch = {}) {
  const ref = eventRef(uid, event.id);
  const state = stateRef(uid);
  await getAdminDb().runTransaction(async (transaction) => {
    const stateSnapshot = ROUTINE_TYPES.has(event.type) ? await transaction.get(state) : null;
    transaction.set(ref, { status: "sent", sentAt: FieldValue.serverTimestamp(), processedAt: FieldValue.serverTimestamp(), ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (ROUTINE_TYPES.has(event.type)) {
      const current = stateSnapshot.exists ? stateSnapshot.data() : {};
      transaction.set(state, {
        ...(current.activeRoutineEventId === event.id ? { activeRoutineEventId: FieldValue.delete() } : {}),
        lastRoutineSentAt: FieldValue.serverTimestamp(),
        consecutiveNoActionReminders: event.type.includes("BALANCE") ? Number(current.consecutiveNoActionReminders || 0) + 1 : Number(current.consecutiveNoActionReminders || 0),
        ...(event.type.includes("SETUP_NUDGE") ? { setupNudgeSentAt: FieldValue.serverTimestamp() } : {}),
        ...(event.type === "BALANCE_REMINDERS_PAUSED" ? { pauseNoticePending: false, pauseNoticeSentAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
}

export async function failNotificationEvent(uid, event, reason, { cancel = false, permanent = false, now = new Date() } = {}) {
  const status = cancel ? "cancelled" : permanent || event.attempts >= 5 ? "permanent_failure" : "failed";
  const retryDelayMs = Math.min(6 * 3600000, 5 * 60000 * (2 ** Math.max(0, Number(event.attempts || 1) - 1)));
  const state = stateRef(uid);
  await getAdminDb().runTransaction(async (transaction) => {
    const stateSnapshot = ROUTINE_TYPES.has(event.type) && status !== "failed" ? await transaction.get(state) : null;
    transaction.set(eventRef(uid, event.id), {
      status,
      failureReason: String(reason || status).slice(0, 120),
      ...(cancel ? { cancelledAt: FieldValue.serverTimestamp() } : { failedAt: FieldValue.serverTimestamp() }),
      ...(status === "failed" ? { nextAttemptAt: new Date(now.getTime() + retryDelayMs) } : { nextAttemptAt: FieldValue.delete() }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (stateSnapshot?.data()?.activeRoutineEventId === event.id) {
      transaction.set(state, { activeRoutineEventId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
}

export async function listProcessableEvents(uid) {
  const snapshot = await getAdminDb().collection("users").doc(uid).collection("notificationEvents").where("status", "in", ["queued", "failed", "processing"]).limit(10).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function cancelPendingNotificationTypes(uid, types, reason) {
  const state = stateRef(uid);
  const [snapshot, stateSnapshot] = await Promise.all([
    getAdminDb().collection("users").doc(uid).collection("notificationEvents").where("status", "in", ["queued", "processing", "failed"]).limit(400).get(),
    state.get(),
  ]);
  const batch = getAdminDb().batch();
  let cancelled = 0;
  const cancelledIds = new Set();
  for (const doc of snapshot.docs) {
    if (!types.includes(doc.data().type)) continue;
    batch.set(doc.ref, { status: "cancelled", cancellationReason: reason, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    cancelledIds.add(doc.id);
    cancelled += 1;
  }
  if (cancelled) {
    if (cancelledIds.has(stateSnapshot.data()?.activeRoutineEventId)) batch.set(state, { activeRoutineEventId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  return cancelled;
}
