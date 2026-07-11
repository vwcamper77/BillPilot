import { NextResponse } from "next/server";
import { grantFoundingAccessFromCheckoutSession } from "@/lib/billingAccess.server";
import { createPendingEntitlementFromCheckoutSession, getExpandedCheckoutSession } from "@/lib/entitlements.server";
import { getAdminDb, getFirebaseProjectId } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { recordAnalyticsEvent } from "@/lib/customerProfile.server";

export const runtime = "nodejs";

export async function POST(request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret is not configured." },
      { status: 400 },
    );
  }

  let payload = "";

  try {
    payload = await request.text();
    const event = getStripeServerClient().webhooks.constructEvent(payload, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const rawSession = event.data.object;

      if (rawSession.metadata?.userId) {
        // Legacy flow: session was created by an authenticated checkout, so
        // it already carries a Firebase uid. Untouched code path.
        const record = await grantFoundingAccessFromCheckoutSession(rawSession, {
          stripeEventId: event.id,
        });

        // Retries replay the same event id — only fire the funnel event once.
        if (record?.isNewStripeEvent) {
          await recordAnalyticsEvent({
            eventName: "checkout_completed",
            uid: record.uid || null,
            anonymousSessionId: record.customerAttribution?.anonymousSessionId || null,
            utm_source: record.customerAttribution?.utm_source || null,
            utm_medium: record.customerAttribution?.utm_medium || null,
            utm_campaign: record.customerAttribution?.utm_campaign || null,
          }).catch((analyticsError) => {
            console.error("[stripe-webhook] failed to record checkout_completed analytics event", analyticsError);
          });
        }
      } else {
        // New flow: no Firebase uid yet — re-retrieve with discounts expanded
        // (see getExpandedCheckoutSession) and fulfil against a pending
        // entitlement instead of a user record.
        const expandedSession = await getExpandedCheckoutSession(rawSession.id);
        await createPendingEntitlementFromCheckoutSession(expandedSession);
      }
    }

    // Inert until a mode:"subscription" Checkout Session exists — no
    // subscription product is created by this app today. Kept as a
    // future-proofed hook so subscriptionStatus/MRR can populate later
    // without another webhook migration.
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.deleted") {
      await handleSubscriptionEvent(event);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] checkout handling failed", {
      firebaseProjectId: getFirebaseProjectId(),
    }, error);

    return NextResponse.json(
      { error: error?.message || "Stripe webhook handling failed." },
      { status: payload ? 500 : 400 },
    );
  }
}

async function handleSubscriptionEvent(event) {
  const subscription = event.data.object;
  const stripeCustomerId = String(subscription?.customer || "").trim();

  if (!stripeCustomerId) {
    return;
  }

  const db = getAdminDb();
  const matches = await db.collection("customers").where("stripeCustomerId", "==", stripeCustomerId).limit(1).get();

  if (matches.empty) {
    return;
  }

  const customerDoc = matches.docs[0];
  const subscriptionStatus = event.type === "customer.subscription.created"
    ? (subscription.status === "trialing" ? "trialing" : "active")
    : "canceled";

  await customerDoc.ref.set({ subscriptionStatus }, { merge: true });

  await recordAnalyticsEvent({
    eventName: event.type === "customer.subscription.created" ? "subscription_created" : "subscription_cancelled",
    uid: customerDoc.id,
  }).catch((analyticsError) => {
    console.error("[stripe-webhook] failed to record subscription analytics event", analyticsError);
  });
}
