import {
  describeFirestoreAdminError,
  FieldValue,
  getAdminAuth,
  getAdminDb,
  getFirebaseProjectId,
} from "@/lib/firebaseAdmin";
import { FOUNDING_ACCESS_MONTHS, FOUNDING_PLAN, addMonths, toDateMaybe } from "@/lib/billingAccess";
import { getStripeServerClient } from "@/lib/stripe";

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
}) {
  const db = getAdminDb();
  const userRef = getUserRef(userId);
  const billingRef = getBillingRef(userId);
  const stripeEventRef = getStripeEventRef(stripeEventId || stripeCheckoutSessionId);
  const startedAt = new Date(accessStartDate);
  const expiresAt = addMonths(startedAt, FOUNDING_ACCESS_MONTHS);
  const normalizedEmail = normaliseEmail(email);

  try {
    const snapshots = await Promise.all([
      userRef.get(),
      billingRef.get(),
      stripeEventRef ? stripeEventRef.get() : Promise.resolve(null),
    ]);
    const [userSnapshot, billingSnapshot, stripeEventSnapshot] = snapshots;
    const existingUser = userSnapshot.exists ? userSnapshot.data() : {};
    const existingBilling = billingSnapshot.exists ? billingSnapshot.data() : {};

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
      paid: true,
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
      updatedAt: FieldValue.serverTimestamp(),
      ...(billingSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };

    const batch = db.batch();
    batch.set(userRef, userPayload, { merge: true });
    batch.set(billingRef, billingPayload, { merge: true });

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
          updatedAt: FieldValue.serverTimestamp(),
          ...(stripeEventSnapshot?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
    }

    await batch.commit();

    return {
      ...existingUser,
      ...existingBilling,
      ...userPayload,
      ...billingPayload,
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

  return grantFoundingAccessToUser({
    userId,
    email: resolvedEmail,
    accessStartDate: toDateMaybe(session.created ? session.created * 1000 : new Date()) || new Date(),
    stripeCustomerId: session.customer ? String(session.customer) : null,
    stripeCheckoutSessionId: session.id,
    stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
    stripeEventId,
    amountPaid: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : 500,
    currency: String(session.currency || "gbp").toLowerCase(),
  });
}

export async function grantFoundingAccessFromCheckoutSessionId(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    throw new Error("Missing checkout session id.");
  }

  const session = await getStripeServerClient().checkout.sessions.retrieve(normalizedSessionId);
  return grantFoundingAccessFromCheckoutSession(session);
}
