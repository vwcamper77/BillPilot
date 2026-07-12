import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { getMonthlySubscriptionPriceId, MONTHLY_PRICE_MINOR } from "@/lib/subscriptionFlags";
import { invoiceSubscriptionId, stripeDate, stripeId, subscriptionAccessStatus } from "@/lib/subscriptionState";
import { recordAnalyticsEvent } from "@/lib/customerProfile.server";

function subscriptionRef(id) {
  return getAdminDb().collection("pendingEntitlements").doc(`subscription_${id}`);
}

function eventRef(id) {
  return getAdminDb().collection("stripeEvents").doc(id);
}

function periodEnd(subscription) {
  return stripeDate(subscription.current_period_end) || stripeDate(subscription.trial_end);
}

function subscriptionFields(subscription, extra = {}) {
  const price = subscription.items?.data?.[0]?.price;
  const status = String(subscription.status || "incomplete");
  return {
    billingMode: "subscription",
    plan: "monthly_subscription",
    planKey: "monthly_subscription",
    planName: "ClearTill Monthly",
    paymentType: status === "trialing" ? "trial" : "subscription",
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: stripeId(subscription.customer),
    stripePriceId: price?.id || null,
    subscriptionStatus: status,
    status: subscriptionAccessStatus(status),
    trialStartAt: stripeDate(subscription.trial_start),
    trialEndAt: stripeDate(subscription.trial_end),
    currentPeriodStart: stripeDate(subscription.current_period_start),
    currentPeriodEnd: stripeDate(subscription.current_period_end),
    accessStartsAt: stripeDate(subscription.start_date || subscription.created),
    accessExpiresAt: periodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: stripeDate(subscription.canceled_at),
    cancellationDate: stripeDate(subscription.cancel_at),
    currency: String(price?.currency || "gbp").toLowerCase(),
    amountPaidMinor: null,
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  };
}

async function currentSubscription(object) {
  const id = object?.object === "subscription" ? object.id : invoiceSubscriptionId(object);
  if (!id) throw new Error("Stripe event did not identify a subscription.");
  return getStripeServerClient().subscriptions.retrieve(id, { expand: ["items.data.price"] });
}

async function trustedUid(subscription, fallbackUid = null) {
  const uid = String(subscription.metadata?.firebase_uid || fallbackUid || "").trim();
  if (!uid) throw new Error("Subscription has no internal account identifier.");
  await getAdminAuth().getUser(uid);
  return uid;
}

export async function processSubscriptionCheckout(session, eventId) {
  const subscription = await getStripeServerClient().subscriptions.retrieve(stripeId(session.subscription), { expand: ["items.data.price"] });
  const uid = await trustedUid(subscription, session.metadata?.firebase_uid || session.client_reference_id);
  const expectedPrice = getMonthlySubscriptionPriceId();
  const actualPrice = subscription.items?.data?.[0]?.price?.id;
  if (actualPrice !== expectedPrice) throw new Error("Subscription Price does not match the configured monthly Price.");

  const firebaseUser = await getAdminAuth().getUser(uid);
  const checkoutEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  if (!firebaseUser.emailVerified || !checkoutEmail || checkoutEmail !== String(firebaseUser.email || "").toLowerCase()) {
    throw new Error("Checkout identity could not be verified.");
  }

  return persistSubscriptionEvent({
    eventId,
    eventType: "checkout.session.completed",
    subscription,
    uid,
    extra: {
      stripeCheckoutSessionId: session.id,
      checkoutEmail,
      billingEmail: checkoutEmail,
      gaClientId: String(session.metadata?.gaClientId || "").trim() || null,
    },
  });
}

export async function processSubscriptionLifecycle(event) {
  const subscription = await currentSubscription(event.data.object);
  const uid = await trustedUid(subscription);
  const object = event.data.object;
  const invoice = object?.object === "invoice" ? object : null;
  const extra = invoice ? {
    latestInvoiceStatus: String(invoice.status || "unknown"),
    latestInvoiceId: invoice.id,
    ...(event.type === "invoice.paid" && Number(invoice.amount_paid) > 0 ? { firstSuccessfulPaymentCandidateAt: stripeDate(invoice.status_transitions?.paid_at) || new Date() } : {}),
  } : {};
  return persistSubscriptionEvent({ eventId: event.id, eventType: event.type, subscription, uid, extra, invoice });
}

async function persistSubscriptionEvent({ eventId, eventType, subscription, uid, extra = {}, invoice = null }) {
  const db = getAdminDb();
  const entRef = subscriptionRef(subscription.id);
  const customerRef = db.collection("customers").doc(uid);
  const evtRef = eventRef(eventId);
  const result = await db.runTransaction(async (transaction) => {
    const [eventSnapshot, entitlementSnapshot, customerSnapshot] = await Promise.all([
      transaction.get(evtRef), transaction.get(entRef), transaction.get(customerRef),
    ]);
    if (eventSnapshot.exists) return { duplicate: true, uid };

    const existingEntitlement = entitlementSnapshot.exists ? entitlementSnapshot.data() : {};
    const existingCustomer = customerSnapshot.exists ? customerSnapshot.data() : {};
    const firstPaymentAt = existingEntitlement.firstSuccessfulPaymentAt
      || extra.firstSuccessfulPaymentCandidateAt
      || null;
    const fields = subscriptionFields(subscription, {
      uid,
      claimedUid: uid,
      claimedEmail: existingEntitlement.claimedEmail || extra.checkoutEmail || existingCustomer.email || null,
      firstSuccessfulPaymentAt: firstPaymentAt,
      latestInvoiceStatus: extra.latestInvoiceStatus || existingEntitlement.latestInvoiceStatus || null,
      latestInvoiceId: extra.latestInvoiceId || existingEntitlement.latestInvoiceId || null,
      stripeCheckoutSessionId: extra.stripeCheckoutSessionId || existingEntitlement.stripeCheckoutSessionId || null,
      checkoutEmail: extra.checkoutEmail || existingEntitlement.checkoutEmail || existingCustomer.email || null,
      gaClientId: extra.gaClientId || existingEntitlement.gaClientId || null,
      ...(entitlementSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    });
    transaction.set(entRef, fields, { merge: true });
    transaction.set(customerRef, {
      uid,
      billingMode: "subscription",
      stripeCustomerId: stripeId(subscription.customer),
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items?.data?.[0]?.price?.id || null,
      subscriptionStatus: subscription.status,
      trialStartAt: stripeDate(subscription.trial_start),
      trialEndAt: stripeDate(subscription.trial_end),
      currentBillingPeriodEnd: stripeDate(subscription.current_period_end),
      subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      cancellationDate: stripeDate(subscription.cancel_at || subscription.canceled_at),
      latestInvoiceStatus: extra.latestInvoiceStatus || existingCustomer.latestInvoiceStatus || null,
      firstSuccessfulPaymentAt: existingCustomer.firstSuccessfulPaymentAt || firstPaymentAt,
      paymentStatus: eventType === "invoice.payment_failed" ? "failed" : eventType === "invoice.paid" ? "paid" : existingCustomer.paymentStatus || "trial",
      ...(invoice && eventType === "invoice.paid" && Number(invoice.amount_paid) > 0 && !existingCustomer.firstSuccessfulPaymentAt
        ? { totalPaid: FieldValue.increment(Number(invoice.amount_paid)) }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
      ...(customerSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.set(evtRef, { eventId, eventType, uid, stripeSubscriptionId: subscription.id, processedAt: FieldValue.serverTimestamp() });
    return { duplicate: false, uid, firstPaidInvoice: Boolean(invoice && eventType === "invoice.paid" && Number(invoice.amount_paid) > 0 && !existingCustomer.firstSuccessfulPaymentAt) };
  });

  if (!result.duplicate) {
    const analyticsName = eventType === "checkout.session.completed" ? "trial_started"
      : eventType === "invoice.payment_failed" ? "invoice_payment_failed"
      : result.firstPaidInvoice ? "first_invoice_paid"
      : eventType === "customer.subscription.deleted" ? "subscription_cancelled" : null;
    if (analyticsName) await recordAnalyticsEvent({ eventName: analyticsName, uid }).catch(() => undefined);
  }
  return result;
}

export const SUBSCRIPTION_AMOUNT_MINOR = MONTHLY_PRICE_MINOR;

