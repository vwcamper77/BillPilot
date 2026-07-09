import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { FOUNDING_ACCESS_MONTHS, FOUNDING_PLAN, addMonths, toDateMaybe } from "@/lib/billingAccess";
import { getStripeServerClient } from "@/lib/stripe";

function getBillingRef(userId) {
  if (!userId) {
    throw new Error("Missing user id.");
  }

  return getAdminDb().collection("users").doc(userId).collection("settings").doc("billing");
}

export async function getBillingRecord(userId) {
  const snapshot = await getBillingRef(userId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function grantFoundingAccessToUser({
  userId,
  accessStartDate = new Date(),
  stripeCustomerId = null,
  stripeCheckoutSessionId = null,
  amountPaid = 500,
  currency = "gbp",
}) {
  const billingRef = getBillingRef(userId);
  const existingSnapshot = await billingRef.get();
  const startedAt = new Date(accessStartDate);
  const expiresAt = addMonths(startedAt, FOUNDING_ACCESS_MONTHS);

  const payload = {
    plan: FOUNDING_PLAN,
    paid: true,
    accessStartedAt: startedAt,
    accessExpiresAt: expiresAt,
    stripeCustomerId: stripeCustomerId || null,
    stripeCheckoutSessionId: stripeCheckoutSessionId || null,
    amountPaid,
    currency,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existingSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  await billingRef.set(payload, { merge: true });

  return {
    ...(existingSnapshot.exists ? existingSnapshot.data() : {}),
    ...payload,
  };
}

export async function grantFoundingAccessByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  const userRecord = await getAdminAuth().getUserByEmail(normalizedEmail);

  return grantFoundingAccessToUser({
    userId: userRecord.uid,
    accessStartDate: new Date(),
  });
}

export async function grantFoundingAccessFromCheckoutSession(session) {
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

  if (!userId && customerEmail) {
    const userRecord = await getAdminAuth().getUserByEmail(customerEmail);
    userId = userRecord.uid;
  }

  if (!userId) {
    throw new Error("Could not determine which user to unlock for this checkout.");
  }

  return grantFoundingAccessToUser({
    userId,
    accessStartDate: toDateMaybe(session.created ? session.created * 1000 : new Date()) || new Date(),
    stripeCustomerId: session.customer ? String(session.customer) : null,
    stripeCheckoutSessionId: session.id,
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
