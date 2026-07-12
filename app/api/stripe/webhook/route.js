import { NextResponse } from "next/server";
import { claimPendingEntitlement, createPendingEntitlementFromCheckoutSession, getExpandedCheckoutSession } from "@/lib/entitlements.server";
import { getAdminAuth, getAdminDb, getFirebaseProjectId } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { recordAnalyticsEvent } from "@/lib/customerProfile.server";

export const runtime = "nodejs";

export async function POST(request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 400 });
  }

  let payload = "";
  try {
    payload = await request.text();
    const event = getStripeServerClient().webhooks.constructEvent(payload, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const rawSession = event.data.object;
      const session = await getExpandedCheckoutSession(rawSession.id);
      const created = await createPendingEntitlementFromCheckoutSession(session, { webhookEventId: event.id });
      const trustedUid = String(session.metadata?.firebase_uid || session.metadata?.userId || session.client_reference_id || "").trim();

      if (trustedUid) {
        const firebaseUser = await getAdminAuth().getUser(trustedUid);
        const checkoutEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
        const firebaseEmail = String(firebaseUser.email || "").trim().toLowerCase();
        if (!firebaseUser.emailVerified || !firebaseEmail || firebaseEmail !== checkoutEmail) {
          throw new Error("Signed-in checkout identity could not be verified against the Stripe checkout email.");
        }
        await claimPendingEntitlement({ sessionId: session.id, uid: trustedUid, verifiedEmail: firebaseEmail });
      }

      if (created?.isNewSession) {
        await recordAnalyticsEvent({ eventName: "checkout_completed", uid: trustedUid || null }).catch((error) => {
          console.error("[stripe-webhook] failed to record checkout_completed analytics event", error);
        });
      }
    }

    if (["customer.subscription.created", "customer.subscription.deleted"].includes(event.type)) {
      await handleSubscriptionEvent(event);
    }

    if (["charge.refunded", "payment_intent.payment_failed"].includes(event.type)) {
      await handlePaymentStateEvent(event);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] handling failed", { firebaseProjectId: getFirebaseProjectId() }, error);
    return NextResponse.json({ error: error?.message || "Stripe webhook handling failed." }, { status: payload ? 500 : 400 });
  }
}

async function handlePaymentStateEvent(event) {
  const object = event.data.object;
  const paymentIntentId = String(object?.payment_intent || object?.id || "").trim();
  if (!paymentIntentId) return;
  const matches = await getAdminDb().collection("pendingEntitlements").where("stripePaymentIntentId", "==", paymentIntentId).limit(10).get();
  const status = event.type === "charge.refunded" ? "refunded" : "revoked";
  const batch = getAdminDb().batch();
  for (const doc of matches.docs) batch.set(doc.ref, { status, webhookEventId: event.id, updatedAt: new Date() }, { merge: true });
  await batch.commit();
}

async function handleSubscriptionEvent(event) {
  const subscription = event.data.object;
  const stripeCustomerId = String(subscription?.customer || "").trim();
  if (!stripeCustomerId) return;
  const matches = await getAdminDb().collection("customers").where("stripeCustomerId", "==", stripeCustomerId).limit(1).get();
  if (matches.empty) return;
  const customerDoc = matches.docs[0];
  const subscriptionStatus = event.type === "customer.subscription.created"
    ? (subscription.status === "trialing" ? "trialing" : "active")
    : "canceled";
  await customerDoc.ref.set({ subscriptionStatus }, { merge: true });
  await recordAnalyticsEvent({
    eventName: event.type === "customer.subscription.created" ? "subscription_created" : "subscription_cancelled",
    uid: customerDoc.id,
  }).catch((error) => console.error("[stripe-webhook] subscription analytics failed", error));
}
