import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/billing/stripe";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { completeStripeEvent, failStripeEvent, markStripeEventProcessed, syncSubscriptionState, upsertUserProfile } from "@/lib/billing/store";
import { syncStripeSubscriptionToFirestore } from "@/lib/billing/subscriptionSync";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { safeError, safeInfo } from "@/lib/security/safeLog";
import { createPendingTrialClaim } from "@/lib/billing/trialClaims.server";
import { getTrialCheckoutIntent } from "@/lib/billing/trialClaims.server";
import { claimPendingEntitlement, createPendingEntitlementFromCheckoutSession, getExpandedCheckoutSession } from "@/lib/entitlements.server";
import { recordVerifiedPaidInvoice, recordVerifiedTrial } from "@/lib/billing/commercialOutcomes.server";
import { attributionFromStripeMetadata } from "@/lib/analytics/attribution.server";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  const runtime = getBillingRuntimeConfig();
  if (!runtime.ok) {
    return NextResponse.json({ ok: false, error: runtime.message }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });
  }

  const body = await request.text();

  let verifiedEventId = "";
  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    verifiedEventId = event.id;
    const wasInserted = await markStripeEventProcessed(event.id, {
      type: event.type,
      created: event.created || 0,
    });

    if (!wasInserted) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const outcome = await handleStripeEvent(stripe, event);
    await completeStripeEvent(event.id, outcome || {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    await failStripeEvent(verifiedEventId, error).catch(() => undefined);
    safeError("[stripe-webhook] failed", { type: "webhook_error" });
    return NextResponse.json(
      { ok: false, error: error?.message || "Webhook processing failed." },
      { status: 500 },
    );
  }
}

async function handleStripeEvent(stripe, event) {
  const object = event.data?.object || {};
  const eventCreated = Number(event.created || 0) * 1000;

  switch (event.type) {
    case "checkout.session.completed": {
      if (object.mode === "payment") {
        const session = await getExpandedCheckoutSession(object.id);
        const uid = String(session.metadata?.firebaseUid || session.client_reference_id || "").trim();
        const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
        if (uid && stripeCustomerId) await stripe.customers.update(stripeCustomerId, { metadata: { firebaseUid: uid } });
        await createPendingEntitlementFromCheckoutSession(session, { webhookEventId: event.id });
        if (uid) {
          const authUser = await getAdminAuth().getUser(uid).catch(() => null);
          const checkoutEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
          if (!authUser?.emailVerified || String(authUser.email || "").trim().toLowerCase() !== checkoutEmail) {
            return { uid, stripeCheckoutSessionId: object.id, reconciliationWarning: "firebase_checkout_email_mismatch" };
          }
          await claimPendingEntitlement({ sessionId: session.id, uid, verifiedEmail: authUser.email });
        }
        return {
          uid: uid || null,
          stripeCheckoutSessionId: object.id,
          stripeCustomerId: typeof object.customer === "string" ? object.customer : object.customer?.id || null,
          stripePaymentIntentId: typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null,
          paymentStatus: object.payment_status || null,
        };
      }
      const uid = object.metadata?.firebaseUid;
      if (!uid) return { reconciliationWarning: "missing_firebase_uid" };
      if (object.mode !== "subscription" || !object.subscription) return { ignoredReason: "not_subscription_checkout" };
      const subscription = typeof object.subscription === "object"
        ? object.subscription
        : await stripe.subscriptions.retrieve(object.subscription, { expand: ["latest_invoice"] });
      if (object.metadata?.checkoutIntentId) {
        await createPendingTrialClaim({ session: object, subscription, stripeEventId: event.id });
      }
      const stripeCustomerId = typeof object.customer === "string" ? object.customer : object.customer?.id || "";
      const customerEmail = object.customer_details?.email || "";
      const checkoutIntent = await getTrialCheckoutIntent(object.metadata?.checkoutIntentId);
      const attribution = checkoutIntent?.attribution || attributionFromStripeMetadata(object.metadata);
      const internalTest = String(object.metadata?.internal_test || subscription.metadata?.internal_test || "") === "1"
        || Boolean(checkoutIntent?.internalTest);
      await upsertUserProfile(uid, {
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
      });
      if (stripeCustomerId) {
        await stripe.customers.update(stripeCustomerId, {
          metadata: { firebaseUid: uid },
        });
      }
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        customerEmail,
        extras: {
          stripeCustomerId,
          checkoutCompletedAt: eventCreated || Date.now(),
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
          lastCheckoutSessionId: object.id,
          internalTest,
          excludedFromCommercialReporting: internalTest,
        },
      });
      await recordVerifiedTrial({ uid, sessionId: object.id, subscription, internalTest, attribution, stripeEventId: event.id, customerEmail });
      return { uid, stripeCheckoutSessionId: object.id, stripeCustomerId, stripeSubscriptionId: subscription.id };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end": {
      const subscription = typeof object.id === "string"
        ? await stripe.subscriptions.retrieve(object.id, {
          expand: ["latest_invoice"],
        })
        : object;
      const identity = await resolveStripeIdentity(stripe, subscription);
      const uid = identity.uid;
      if (!uid) return { reconciliationWarning: "missing_firebase_uid", stripeSubscriptionId: subscription.id };
      if (identity.source !== "subscription_metadata") {
        await stripe.subscriptions.update(subscription.id, { metadata: { firebaseUid: uid } });
      }
      if (identity.customerId && identity.source !== "customer_metadata") {
        await stripe.customers.update(identity.customerId, { metadata: { firebaseUid: uid } });
      }
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        customerEmail: identity.email || subscription.metadata?.customerEmail || "",
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
        },
      });
      if (event.type === "customer.subscription.deleted") {
        const cancelledDuringTrial = Number(subscription.trial_end || 0) > 0
          && Number(subscription.canceled_at || event.created || 0) <= Number(subscription.trial_end);
        if (cancelledDuringTrial && String(subscription.metadata?.internal_test || "") !== "1") {
          await trackServerAnalyticsEvent("trial_cancelled", { uid, source: "stripe_webhook" });
        }
      }
      return { uid, stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null, stripeSubscriptionId: subscription.id };
    }

    case "invoice.paid": {
      const subscriptionId = typeof object.subscription === "string"
        ? object.subscription
        : object.parent?.subscription_details?.subscription || object.subscription_details?.subscription || "";
      if (!subscriptionId) return { reconciliationWarning: "invoice_missing_subscription" };
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
      const identity = await resolveStripeIdentity(stripe, subscription);
      const firebaseUid = identity.uid;
      if (!firebaseUid) return { reconciliationWarning: "missing_firebase_uid", stripeSubscriptionId: subscription.id };
      const checkoutIntent = await getTrialCheckoutIntent(subscription.metadata?.checkoutIntentId);
      const internalTest = String(subscription.metadata?.internal_test || "") === "1" || Boolean(checkoutIntent?.internalTest);
      await syncStripeSubscriptionToFirestore({
        uid: firebaseUid,
        subscription,
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
          latestInvoiceStatus: object.status || "",
          firstSuccessfulPaymentAt: Number(object.amount_paid) > 0 && (object.billing_reason === "subscription_create" || object.attempt_count === 1)
            ? eventCreated || Date.now()
            : null,
          internalTest,
          excludedFromCommercialReporting: internalTest,
        },
      });
      await recordVerifiedPaidInvoice({
        uid: firebaseUid,
        invoice: object,
        internalTest,
        attribution: checkoutIntent?.attribution || null,
        subscription,
        stripeEventId: event.id,
      });
      return { uid: firebaseUid, stripeSubscriptionId: subscription.id, stripeInvoiceId: object.id, amountPaid: Number(object.amount_paid) || 0, currency: object.currency || null };
    }

    case "invoice.payment_failed": {
      const subscriptionId = typeof object.subscription === "string"
        ? object.subscription
        : object.parent?.subscription_details?.subscription || object.subscription_details?.subscription || "";
      if (!subscriptionId) return { reconciliationWarning: "invoice_missing_subscription" };
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
      const identity = await resolveStripeIdentity(stripe, subscription);
      const uid = identity.uid;
      if (!uid) return { reconciliationWarning: "missing_firebase_uid", stripeSubscriptionId: subscription.id };
      const checkoutIntent = await getTrialCheckoutIntent(subscription.metadata?.checkoutIntentId);
      const internalTest = String(subscription.metadata?.internal_test || "") === "1" || Boolean(checkoutIntent?.internalTest);
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
          latestInvoiceStatus: object.status || "payment_failed",
        },
      });
      if (!internalTest) await trackServerAnalyticsEvent("invoice_payment_failed", { uid, source: "stripe_webhook" });
      return { uid, stripeSubscriptionId: subscription.id, stripeInvoiceId: object.id, paymentStatus: "failed" };
    }

    default:
      safeInfo("[stripe-webhook] ignored", { type: event.type });
      return { ignoredReason: "unsupported_event_type" };
  }
}

/** Metadata is authoritative. Email lookup is a documented recovery fallback for legacy Stripe objects only. */
async function resolveStripeIdentity(stripe, subscription) {
  const metadataUid = String(subscription?.metadata?.firebaseUid || "").trim();
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id || "";
  const customer = customerId ? await stripe.customers.retrieve(customerId) : null;
  const customerUid = customer && !customer.deleted ? String(customer.metadata?.firebaseUid || "").trim() : "";
  const email = customer && !customer.deleted ? String(customer.email || "").trim().toLowerCase() : "";
  if (metadataUid || customerUid) return { uid: metadataUid || customerUid, email, customerId, source: metadataUid ? "subscription_metadata" : "customer_metadata" };
  if (!email) return { uid: "", email: "", customerId, source: "missing" };
  try {
    const user = await getAdminAuth().getUserByEmail(email);
    return { uid: user.uid, email, customerId, source: "legacy_email_fallback" };
  } catch {
    return { uid: "", email, customerId, source: "email_unmatched" };
  }
}
