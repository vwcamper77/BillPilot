import {
  describeFirestoreAdminError,
  FieldValue,
  getAdminAuth,
  getAdminDb,
  getFirebaseProjectId,
} from "@/lib/firebaseAdmin";
import { FOUNDING_ACCESS_MONTHS, FOUNDING_PLAN, addMonths, toDateMaybe } from "@/lib/billingAccess";
import { getStripeServerClient } from "@/lib/stripe";
import { FOUNDING_ITEM, hashForAnalytics, sendGa4Event } from "@/lib/analytics/ga4.server";

function getUserRef(userId) {
  if (!userId) {
    throw new Error("Missing user id.");
  }

  return getAdminDb().collection("users").doc(userId);
}

function getBillingRef(userId) {
  if (!userId) {
    throw new Error("Missing user id.");
  }

  return getAdminDb().collection("users").doc(userId).collection("settings").doc("billing");
}

function getStripeEventRef(eventId) {
  if (!eventId) {
    return null;
  }

  return getAdminDb().collection("stripeEvents").doc(eventId);
}

function getCustomerRef(userId) {
  if (!userId) {
    throw new Error("Missing user id.");
  }

  return getAdminDb().collection("customers").doc(userId);
}

function normaliseEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

function buildGrantFailure(error, context) {
  const failure = new Error(describeFirestoreAdminError(error));
  failure.code = error?.code;
  failure.cause = error;
  failure.context = context;
  return failure;
}

export async function getBillingRecord(userId) {
  const snapshot = await getBillingRef(userId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function getFoundingMemberCount() {
  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .where("accessPlan", "==", "founding")
      .count()
      .get();

    return snapshot.data().count || 0;
  } catch (error) {
    console.error("[billing-access] failed to count founding members", {
      firebaseProjectId: getFirebaseProjectId(),
    }, error);
    return null;
  }
}

export async function grantFoundingAccessToUser({
  userId,
  email = null,
  accessStartDate = new Date(),
  stripeCustomerId = null,
  stripeCheckoutSessionId = null,
  stripeSubscriptionId = null,
  stripeEventId = null,
  amountPaid = 500,
  currency = "gbp",
  accessSource = "stripe",
  paymentStatus = "",
  coupon = null,
  gaClientId = null,
}) {
  const db = getAdminDb();
  const userRef = getUserRef(userId);
  const billingRef = getBillingRef(userId);
  // The Checkout Session is the order identity. Webhook event IDs change across
  // retries/replays and the success page has no event ID.
  const stripeEventRef = getStripeEventRef(stripeCheckoutSessionId || stripeEventId);
  const customerRef = getCustomerRef(userId);
  const startedAt = new Date(accessStartDate);
  const expiresAt = addMonths(startedAt, FOUNDING_ACCESS_MONTHS);
  const normalizedEmail = normaliseEmail(email);

  try {
    const snapshots = await Promise.all([
      userRef.get(),
      billingRef.get(),
      stripeEventRef ? stripeEventRef.get() : Promise.resolve(null),
      customerRef.get(),
    ]);
    const [userSnapshot, billingSnapshot, stripeEventSnapshot, customerSnapshot] = snapshots;
    const existingUser = userSnapshot.exists ? userSnapshot.data() : {};
    const existingBilling = billingSnapshot.exists ? billingSnapshot.data() : {};
    // A Stripe webhook retry replays the same event id — only the very first
    // time we see it should we increment totalPaid, or a retry would double
    // the customer's recorded revenue.
    const isNewStripeEvent = !stripeEventSnapshot?.exists;

    const isQaPurchase = coupon === "CLEAR100";
    const isGenuinePaidOrder = amountPaid > 0 && !isQaPurchase;
    const userPayload = {
      uid: userId,
      email: normalizedEmail || existingUser?.email || null,
      accessStatus: "active",
      accessSource,
      accessPlan: "founding",
      accessUntil: expiresAt,
      stripeCustomerId: stripeCustomerId || existingUser?.stripeCustomerId || null,
      stripeCheckoutSessionId: stripeCheckoutSessionId || existingUser?.stripeCheckoutSessionId || null,
      stripeSubscriptionId: stripeSubscriptionId || existingUser?.stripeSubscriptionId || null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };

    const billingPayload = {
      plan: FOUNDING_PLAN,
      paid: isGenuinePaidOrder,
      accessStatus: "active",
      accessSource,
      accessStartedAt: startedAt,
      accessExpiresAt: expiresAt,
      accessUntil: expiresAt,
      stripeCustomerId: stripeCustomerId || existingBilling?.stripeCustomerId || null,
      stripeCheckoutSessionId: stripeCheckoutSessionId || existingBilling?.stripeCheckoutSessionId || null,
      stripeSubscriptionId: stripeSubscriptionId || existingBilling?.stripeSubscriptionId || null,
      amountPaid,
      currency,
      coupon,
      updatedAt: FieldValue.serverTimestamp(),
      ...(billingSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };

    const customerPayload = {
      uid: userId,
      email: userPayload.email,
      stripeCustomerId: userPayload.stripeCustomerId,
      currency,
      lastActiveAt: FieldValue.serverTimestamp(),
      subscriptionStatus: "none",
      ...(customerSnapshot.exists
        ? {}
        : {
          name: null,
          attribution: null,
          billsCount: 0,
          onboardingStatus: "not_started",
          dropOffStage: null,
          firstActionAfterSignup: null,
          createdAt: FieldValue.serverTimestamp(),
        }),
      // Only apply on first-seen events — see isNewStripeEvent note above.
      ...(isNewStripeEvent && isGenuinePaidOrder
        ? { paymentStatus: "paid", totalPaid: FieldValue.increment(amountPaid) }
        : isNewStripeEvent && isQaPurchase
          ? { paymentStatus: "qa", totalPaid: customerSnapshot.data()?.totalPaid || 0 }
        : {}),
    };

    const batch = db.batch();
    batch.set(userRef, userPayload, { merge: true });
    batch.set(billingRef, billingPayload, { merge: true });
    batch.set(customerRef, customerPayload, { merge: true });

    if (stripeEventRef) {
      batch.set(
        stripeEventRef,
        {
          uid: userId,
          email: userPayload.email,
          accessPlan: "founding",
          accessSource,
          stripeCheckoutSessionId: stripeCheckoutSessionId || null,
          stripeSubscriptionId: stripeSubscriptionId || null,
          coupon,
          ga4EventName: isQaPurchase ? "qa_purchase" : isGenuinePaidOrder ? "purchase" : null,
          updatedAt: FieldValue.serverTimestamp(),
          ...(stripeEventSnapshot?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
    }

    await batch.commit();

    if (isNewStripeEvent && (isQaPurchase || isGenuinePaidOrder)) {
      await sendGa4Event({
        eventName: isQaPurchase ? "qa_purchase" : "purchase",
        clientId: gaClientId,
        userId,
        params: {
          transaction_id: hashForAnalytics(stripeCheckoutSessionId),
          value: isQaPurchase ? 0 : amountPaid / 100,
          currency: "GBP",
          ...(coupon ? { coupon } : {}),
          ...(isQaPurchase ? { test_flow: true } : {}),
          items: [{ ...FOUNDING_ITEM, price: isQaPurchase ? 0 : amountPaid / 100 }],
        },
      }).catch((error) => console.error("[ga4-purchase] send failed", { stripeCheckoutSessionId, userId }, error));
    }

    return {
      ...existingUser,
      ...existingBilling,
      ...userPayload,
      ...billingPayload,
      isNewStripeEvent,
      customerAttribution: customerSnapshot.exists ? customerSnapshot.data()?.attribution || null : null,
    };
  } catch (error) {
    const context = {
      stripeSessionId: stripeCheckoutSessionId || null,
      uid: userId || null,
      email: normalizedEmail,
      firebaseProjectId: getFirebaseProjectId(),
      attemptedUserDocPath: userId ? userRef.path : "",
      attemptedBillingDocPath: userId ? billingRef.path : "",
      stripeSubscriptionId: stripeSubscriptionId || null,
      stripeEventId: stripeEventId || null,
      paymentStatus: paymentStatus || null,
    };

    console.error("[billing-access] failed to grant founding access", context, error);
    throw buildGrantFailure(error, context);
  }
}

export async function grantFoundingAccessByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const userRecord = await getAdminAuth().getUserByEmail(normalizedEmail);

  return grantFoundingAccessToUser({
    userId: userRecord.uid,
    email: userRecord.email || normalizedEmail,
    accessStartDate: new Date(),
    accessSource: "admin_override",
  });
}

export async function grantFoundingAccessFromCheckoutSession(session, { stripeEventId = null } = {}) {
  if (!session?.id) {
    throw new Error("Missing Stripe Checkout session.");
  }

  if (session.mode !== "payment") {
    throw new Error("Only one-time payment checkout sessions can grant founding access.");
  }

  if (session.payment_status !== "paid") {
    throw new Error("Stripe Checkout session is not marked as paid.");
  }

  const metadataUserId = String(session.metadata?.userId || "").trim();
  const customerEmail = String(
    session.customer_details?.email
      || session.customer_email
      || session.metadata?.userEmail
      || "",
  ).trim().toLowerCase();

  let userId = metadataUserId;
  let resolvedEmail = customerEmail;

  if (!userId && customerEmail) {
    const userRecord = await getAdminAuth().getUserByEmail(customerEmail);
    userId = userRecord.uid;
    resolvedEmail = userRecord.email || customerEmail;
  }

  if (userId && !resolvedEmail) {
    try {
      const userRecord = await getAdminAuth().getUser(userId);
      resolvedEmail = userRecord.email || null;
    } catch {
      resolvedEmail = null;
    }
  }

  if (!userId) {
    throw new Error("Could not determine which user to unlock for this checkout.");
  }

  const attemptedUserDocPath = getUserRef(userId).path;
  const attemptedBillingDocPath = getBillingRef(userId).path;

  console.info("[billing-access] verified paid checkout session", {
    stripeSessionId: session.id,
    uid: userId,
    email: resolvedEmail,
    paymentStatus: session.payment_status,
    firebaseProjectId: getFirebaseProjectId(),
    attemptedUserDocPath,
    attemptedBillingDocPath,
  });

  const coupon = await getCheckoutCoupon(session);
  const record = await grantFoundingAccessToUser({
    userId,
    email: resolvedEmail,
    accessStartDate: toDateMaybe(session.created ? session.created * 1000 : new Date()) || new Date(),
    stripeCustomerId: session.customer ? String(session.customer) : null,
    stripeCheckoutSessionId: session.id,
    stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
    stripeEventId,
    amountPaid: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : 500,
    currency: String(session.currency || "gbp").toLowerCase(),
    paymentStatus: session.payment_status,
    coupon,
    gaClientId: String(session.metadata?.gaClientId || "").trim() || null,
  });

  console.info("[billing-access] access grant success", {
    stripeSessionId: session.id,
    uid: userId,
    email: resolvedEmail,
    paymentStatus: session.payment_status,
    attemptedUserDocPath,
    attemptedBillingDocPath,
  });

  return record;
}

export async function grantFoundingAccessFromCheckoutSessionId(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    throw new Error("Missing checkout session id.");
  }

  const session = await getStripeServerClient().checkout.sessions.retrieve(normalizedSessionId, {
    expand: ["discounts.promotion_code"],
  });
  return grantFoundingAccessFromCheckoutSession(session);
}

export async function getCheckoutCoupon(session) {
  const discounts = Array.isArray(session?.discounts) ? session.discounts : [];
  for (const discount of discounts) {
    const promotion = discount?.promotion_code;
    if (promotion && typeof promotion === "object" && promotion.code) return String(promotion.code).toUpperCase();
    if (typeof promotion === "string") {
      try {
        const retrieved = await getStripeServerClient().promotionCodes.retrieve(promotion);
        if (retrieved?.code) return String(retrieved.code).toUpperCase();
      } catch (error) {
        console.error("[billing-access] could not resolve promotion code", { stripeSessionId: session?.id }, error);
      }
    }
  }
  return null;
}
