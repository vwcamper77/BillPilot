import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { DROP_OFF_STAGE_EVENTS } from "@/lib/analytics/constants";

const BLOCKED_METADATA_KEY_PATTERN = /amount|balance|price|salary|income|total|cost|spend|email|bill|payday|spoken|bank|name|text|description|memo/i;

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_METADATA_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Best-effort merge write to customers/{uid}. Never throws — analytics
 * bookkeeping must never block the real action it accompanies.
 */
export async function touchCustomerActivity({ uid, patch = {} }) {
  if (!uid) {
    return;
  }

  try {
    await getAdminDb()
      .collection("customers")
      .doc(uid)
      .set({ ...patch, lastActiveAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error("[customer-profile] failed to touch customer activity", { uid }, error);
  }
}

/**
 * Shared analyticsEvents writer, used by both the public /api/track route
 * (client-fired events) and server-to-server call sites like the Stripe
 * webhook (e.g. checkout_completed, which has no browser context).
 */
export async function recordAnalyticsEvent({
  eventName,
  uid = null,
  anonymousSessionId = null,
  pathname = null,
  referrer = null,
  utm_source = null,
  utm_medium = null,
  utm_campaign = null,
  utm_content = null,
  utm_term = null,
  experiment_id = null,
  content_id = null,
  creative_id = null,
  landing_variant = null,
  access_type = null,
  fbclid = null,
  gclid = null,
  device = null,
  metadata = {},
  clientTimestamp = null,
}) {
  const db = getAdminDb();

  await db.collection("analyticsEvents").add({
    eventName,
    uid,
    anonymousSessionId,
    pathname,
    referrer,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    experiment_id,
    content_id,
    creative_id,
    landing_variant,
    access_type,
    fbclid,
    gclid,
    device,
    metadata: sanitizeMetadata(metadata),
    clientTimestamp,
    createdAt: FieldValue.serverTimestamp(),
  });

  if (!uid) {
    return;
  }

  const patch = {};

  if (DROP_OFF_STAGE_EVENTS.has(eventName)) {
    patch.dropOffStage = eventName;
  }

  if (device) {
    patch.lastDevice = device;
  }

  if (eventName !== "account_created" && eventName !== "onboarding_started") {
    try {
      const snapshot = await db.collection("customers").doc(uid).get();
      if (snapshot.exists && !snapshot.data()?.firstActionAfterSignup) {
        patch.firstActionAfterSignup = eventName;
      }
    } catch {
      // Best-effort denormalization only — skip on failure.
    }
  }

  if (Object.keys(patch).length) {
    await touchCustomerActivity({ uid, patch });
  }
}

/**
 * Creates (or attaches attribution to) a customers/{uid} doc when a real
 * account is first created. Idempotent: only sets createdAt/defaults the
 * first time, so it's safe if the Stripe webhook already created a stub
 * record (e.g. ad-blocker prevented the client event from firing).
 */
export async function createOrUpdateCustomerOnAccountCreated({ uid, email, name = null, attribution = null, accountCreatedAt = null }) {
  if (!uid) {
    return;
  }

  const db = getAdminDb();
  const customerRef = db.collection("customers").doc(uid);
  const userRef = db.collection("users").doc(uid);
  const onboardingRef = userRef.collection("access").doc("onboarding");
  const trustedCreatedAt = accountCreatedAt ? new Date(accountCreatedAt) : new Date();
  const onboardingWriteEndsAt = new Date(trustedCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  await db.runTransaction(async (transaction) => {
    const [snapshot, onboardingSnapshot] = await Promise.all([
      transaction.get(customerRef),
      transaction.get(onboardingRef),
    ]);
    transaction.set(customerRef, {
      uid,
      email: email || null,
      lastActiveAt: FieldValue.serverTimestamp(),
      ...(attribution ? { lastTouchAttribution: attribution.lastTouch || attribution } : {}),
      ...(snapshot.exists ? {} : {
        name,
        ...(attribution ? { attribution, firstTouchAttribution: attribution.firstTouch || attribution } : {}),
        createdAt: trustedCreatedAt,
        stripeCustomerId: null,
        paymentStatus: "none",
        subscriptionStatus: "none",
        totalPaid: 0,
        currency: "gbp",
        billsCount: 0,
        onboardingStatus: "not_started",
        dropOffStage: "account_created",
        firstActionAfterSignup: null,
      }),
    }, { merge: true });
    transaction.set(userRef, {
      email: email || null,
      accountCreatedAt: trustedCreatedAt,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (!onboardingSnapshot.exists) {
      transaction.create(onboardingRef, {
        status: "incomplete",
        startedAt: trustedCreatedAt,
        writeEndsAt: onboardingWriteEndsAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}
