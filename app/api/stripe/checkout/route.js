import { NextResponse } from "next/server";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { preventsDuplicateSubscription } from "@/lib/billing/access";
import { getSubscriptionState, syncSubscriptionState, upsertUserProfile } from "@/lib/billing/store";
import { getStripeClient } from "@/lib/billing/stripe";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { verifyRequestUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyRequestUser(request);
    const runtime = getBillingRuntimeConfig();

    if (!runtime.config.enabled) {
      return NextResponse.json(
        { ok: false, error: "Subscription trial is not enabled on this environment." },
        { status: 409 },
      );
    }

    if (!runtime.ok) {
      return NextResponse.json(
        { ok: false, error: runtime.message, code: runtime.code },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const successPath = String(body?.successPath || "/dashboard?checkout=success");
    const cancelPath = String(body?.cancelPath || "/dashboard?checkout=cancelled");
    const stripe = getStripeClient();
    const { subscription } = await getSubscriptionState(decodedToken.uid);

    if (subscription?.stripeSubscriptionId && preventsDuplicateSubscription(subscription.subscriptionStatus)) {
      return NextResponse.json(
        { ok: false, error: "You already have a ClearTill trial or subscription in progress." },
        { status: 409 },
      );
    }

    let stripeCustomerId = subscription?.stripeCustomerId || "";
    const email = decodedToken.email || subscription?.customerEmail || "";

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: {
          firebaseUid: decodedToken.uid,
        },
      });
      stripeCustomerId = customer.id;
    } else if (email) {
      await stripe.customers.update(stripeCustomerId, { email });
    }

    await upsertUserProfile(decodedToken.uid, {
      email,
      stripeCustomerId,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      success_url: `${runtime.config.baseUrl}${successPath}`,
      cancel_url: `${runtime.config.baseUrl}${cancelPath}`,
      payment_method_collection: "always",
      line_items: [{
        price: process.env.STRIPE_MONTHLY_PRICE_ID,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: runtime.config.trialLengthDays,
        metadata: {
          firebaseUid: decodedToken.uid,
          trialOffer: "cleartill-7-day-trial",
          planCommitment: "gbp-199-monthly",
        },
      },
      metadata: {
        firebaseUid: decodedToken.uid,
        planCommitment: "gbp-199-monthly-after-7-day-trial",
      },
      allow_promotion_codes: false,
    });

    await syncSubscriptionState(decodedToken.uid, {
      stripeCustomerId,
      stripePriceId: process.env.STRIPE_MONTHLY_PRICE_ID,
      lastCheckoutSessionId: session.id,
      lastStripeEventAt: Date.now(),
      customerEmail: email,
    }, { force: true });
    await trackServerAnalyticsEvent("trial_checkout_started", { uid: decodedToken.uid, source: "dashboard" });

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      offerHeadline: runtime.config.offerHeadline,
      offerCopy: runtime.config.offerCopy,
      checkoutCommitmentCopy: runtime.config.checkoutCommitmentCopy,
    });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not start Stripe Checkout." },
      { status },
    );
  }
}
