import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { sendGa4Event } from "@/lib/analytics/ga4.server";
import { sendMetaCapiEvent } from "@/lib/analytics/meta.server";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import commercePolicy from "@/lib/billing/commercePolicy.cjs";

export async function recordVerifiedTrial({ uid, sessionId, subscription, internalTest, attribution, stripeEventId = null, customerEmail = null }) {
  if (subscription.status !== "trialing") return { recorded: false, reason: "not_trialing" };
  const ref = getAdminDb().collection("commercialOutcomes").doc(`trial_${sessionId}`);
  let created = true;
  try { await ref.create({ uid, type: "trial_started", internalTest, attribution: attribution || null, analyticsTrustVersion: process.env.ANALYTICS_TRUST_VERSION || null, stripeCheckoutSessionId: sessionId, stripeSubscriptionId: subscription.id, createdAt: FieldValue.serverTimestamp() }); }
  catch (error) { if (error?.code === 6 || String(error?.message || "").includes("Already exists")) created = false; else throw error; }
  const customerRef = getAdminDb().collection("customers").doc(uid);
  const customerSnapshot = await customerRef.get();
  const existingCustomer = customerSnapshot.exists ? customerSnapshot.data() : {};
  await customerRef.set({
    uid,
    internalTest: Boolean(internalTest),
    excludedFromCommercialReporting: Boolean(internalTest),
    subscriptionStatus: "trialing",
    accessType: "active_trial",
    entitlementStatus: "active",
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
    stripeSubscriptionId: subscription.id,
    stripeCheckoutSessionId: sessionId,
    authenticatedEmail: existingCustomer.authenticatedEmail || existingCustomer.email || null,
    paymentEmail: customerEmail || existingCustomer.paymentEmail || null,
    trialStartedAt: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
    lastWebhookEventId: stripeEventId,
    createdAt: existingCustomer.createdAt || FieldValue.serverTimestamp(),
    ...(attribution ? {
      attribution: existingCustomer.attribution || attribution,
      firstTouchAttribution: existingCustomer.firstTouchAttribution || attribution.firstTouch,
      lastTouchAttribution: attribution.lastTouch,
    } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (created && !internalTest) {
    await trackServerAnalyticsEvent("trial_started", { uid, source: "stripe_webhook" });
    await sendMetaCapiEvent({ eventName: "StartTrial", eventId: `trial_${sessionId}`, uid, attribution }).catch(() => undefined);
  }
  return { recorded: created, duplicate: !created };
}

export async function recordVerifiedPaidInvoice({ uid, invoice, internalTest, attribution, gaClientId = null, subscription = null, stripeEventId = null }) {
  const policy = commercePolicy.classifyInvoice(invoice);
  const amountPaid = policy.amount;
  const currency = policy.currency;
  if (!policy.paid) return { recorded: false, reason: "not_positive_gbp_payment" };
  const db = getAdminDb();
  const outcomeRef = db.collection("commercialOutcomes").doc(`invoice_${invoice.id}`);
  const customerRef = db.collection("customers").doc(uid);
  const result = await db.runTransaction(async (transaction) => {
    const [outcome, customer] = await Promise.all([transaction.get(outcomeRef), transaction.get(customerRef)]);
    if (outcome.exists) return { recorded: false, duplicate: true };
    const existing = customer.exists ? customer.data() : {};
    const priorCount = Number(existing.positiveInvoiceCount) || 0;
    const type = priorCount === 0 ? "first_invoice_paid" : "renewal_invoice_paid";
    transaction.create(outcomeRef, { uid, type, internalTest, amountPaid, currency, stripeInvoiceId: invoice.id, attribution: attribution || null, analyticsTrustVersion: process.env.ANALYTICS_TRUST_VERSION || null, createdAt: FieldValue.serverTimestamp() });
    transaction.set(customerRef, {
      uid,
      internalTest: Boolean(internalTest),
      excludedFromCommercialReporting: Boolean(internalTest),
      ...(internalTest ? {} : {
        paymentStatus: "paid",
        totalPaid: FieldValue.increment(amountPaid),
        positiveInvoiceCount: FieldValue.increment(1),
        firstSuccessfulPaymentAt: existing.firstSuccessfulPaymentAt || FieldValue.serverTimestamp(),
        subscriptionStatus: subscription?.status || existing.subscriptionStatus || "active",
        accessType: "active_subscription",
        entitlementStatus: "active",
        stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : existing.stripeCustomerId || null,
        stripeSubscriptionId: subscription?.id || existing.stripeSubscriptionId || null,
        currentPeriodEnd: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000) : existing.currentPeriodEnd || null,
        lastWebhookEventId: stripeEventId,
        lastPaidAmount: amountPaid,
        lastPaidCurrency: currency,
        ...(attribution ? {
          attribution: existing.attribution || attribution,
          firstTouchAttribution: existing.firstTouchAttribution || attribution.firstTouch,
          lastTouchAttribution: attribution.lastTouch,
        } : {}),
      }),
      updatedAt: FieldValue.serverTimestamp(),
      ...(customer.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    return { recorded: true, type };
  });
  if (result.recorded && !internalTest) {
    await trackServerAnalyticsEvent(result.type, { uid, source: "stripe_webhook", transactionId: invoice.id });
    const eventId = invoice.id;
    await Promise.allSettled([
      sendGa4Event({ eventName: "purchase", clientId: gaClientId, userId: uid, params: { transaction_id: invoice.id, value: amountPaid / 100, currency: "GBP" } }),
      sendMetaCapiEvent({ eventName: "Purchase", eventId, uid, attribution, value: amountPaid / 100, currency: "GBP" }),
    ]);
  }
  return result;
}
