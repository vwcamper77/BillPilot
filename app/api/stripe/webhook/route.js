import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/billing/stripe";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { markStripeEventProcessed, syncSubscriptionState, upsertUserProfile } from "@/lib/billing/store";
import { syncStripeSubscriptionToFirestore } from "@/lib/billing/subscriptionSync";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { safeError, safeInfo } from "@/lib/security/safeLog";
import { createPendingTrialClaim } from "@/lib/billing/trialClaims.server";

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

  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    const wasInserted = await markStripeEventProcessed(event.id, {
      type: event.type,
      created: event.created || 0,
    });

    if (!wasInserted) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    await handleStripeEvent(stripe, event);
    return NextResponse.json({ ok: true });
  } catch (error) {
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
      const uid = object.metadata?.firebaseUid;
      if (!uid) return;
      if (object.mode !== "subscription" || !object.subscription) return;
      const subscription = typeof object.subscription === "object"
        ? object.subscription
        : await stripe.subscriptions.retrieve(object.subscription, { expand: ["latest_invoice"] });
      await createPendingTrialClaim({
        session: object,
        subscription,
        stripeEventId: event.id,
      });
      const stripeCustomerId = typeof object.customer === "string" ? object.customer : object.customer?.id || "";
      const customerEmail = object.customer_details?.email || "";
      await upsertUserProfile(uid, {
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
      });
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        customerEmail,
        extras: {
          stripeCustomerId,
          checkoutCompletedAt: eventCreated || Date.now(),
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
        },
      });
      await trackServerAnalyticsEvent("trial_checkout_completed", { uid, source: "stripe_webhook" });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = typeof object.id === "string"
        ? await stripe.subscriptions.retrieve(object.id, {
          expand: ["latest_invoice"],
        })
        : object;
      const uid = subscription.metadata?.firebaseUid;
      if (!uid) return;
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        customerEmail: subscription.metadata?.customerEmail || "",
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
        },
      });
      if (event.type === "customer.subscription.deleted") {
        await trackServerAnalyticsEvent("subscription_cancelled", { uid, source: "stripe_webhook" });
      }
      return;
    }

    case "invoice.paid": {
      const uid = object.subscription_details?.metadata?.firebaseUid
        || object.lines?.data?.[0]?.subscription_item_details?.subscription_item
        || "";
      const subscriptionId = object.subscription;
      if (!subscriptionId) return;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
      const firebaseUid = subscription.metadata?.firebaseUid || uid;
      if (!firebaseUid) return;
      await syncStripeSubscriptionToFirestore({
        uid: firebaseUid,
        subscription,
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
          latestInvoiceStatus: object.status || "",
          firstSuccessfulPaymentAt: object.billing_reason === "subscription_create" || object.attempt_count === 1
            ? eventCreated || Date.now()
            : null,
        },
      });
      await trackServerAnalyticsEvent(
        object.attempt_count > 1 ? "second_invoice_paid" : "first_invoice_paid",
        { uid: firebaseUid, source: "stripe_webhook" },
      );
      if (subscription.status === "active") {
        await trackServerAnalyticsEvent("trial_converted", { uid: firebaseUid, source: "stripe_webhook" });
      }
      return;
    }

    case "invoice.payment_failed": {
      const subscriptionId = object.subscription;
      if (!subscriptionId) return;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });
      const uid = subscription.metadata?.firebaseUid;
      if (!uid) return;
      await syncStripeSubscriptionToFirestore({
        uid,
        subscription,
        extras: {
          lastStripeEventAt: eventCreated || Date.now(),
          lastStripeEventId: event.id,
          latestInvoiceStatus: object.status || "payment_failed",
        },
      });
      await trackServerAnalyticsEvent("invoice_payment_failed", { uid, source: "stripe_webhook" });
      return;
    }

    default:
      safeInfo("[stripe-webhook] ignored", { type: event.type });
  }
}
