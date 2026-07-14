import { NextResponse } from "next/server";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { preventsDuplicateSubscription } from "@/lib/billing/access";
import { getSubscriptionState, syncSubscriptionState } from "@/lib/billing/store";
import { getStripeClient } from "@/lib/billing/stripe";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { verifyRequestUser } from "@/lib/serverAuth";
import {
  attachCheckoutSession,
  createTrialCheckoutIntent,
  normalizeTrialEmail,
  TrialClaimError,
} from "@/lib/billing/trialClaims.server";
import { isInternalAnalyticsRequest } from "@/lib/analytics/internal.server";
import { attributionMetadata, sanitizeAttributionBundle } from "@/lib/analytics/attribution.server";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";

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
    const normalizedEmail = normalizeTrialEmail(body?.email);
    const successPath = String(body?.successPath || "/billing/subscribe/success?session_id={CHECKOUT_SESSION_ID}");
    const cancelPath = String(body?.cancelPath || "/dashboard?checkout=cancelled");
    const stripe = getStripeClient();
    const { subscription } = await getSubscriptionState(decodedToken.uid);
    const entitlement = await resolveEntitlementForUid(decodedToken.uid, { accountEmail: decodedToken.email || null });

    if (entitlement.preventsDuplicateCheckout || (subscription?.stripeSubscriptionId && preventsDuplicateSubscription(subscription.subscriptionStatus))) {
      return NextResponse.json(
        { ok: false, error: entitlement.hasAccess
          ? "Your ClearTill access is already active."
          : "You already have a ClearTill payment or subscription in progress." },
        { status: 409 },
      );
    }

    const stripeCustomerId = entitlement.stripeCustomerId || subscription?.stripeCustomerId || "";
    const email = normalizedEmail;

    if (stripeCustomerId && email) {
      await stripe.customers.update(stripeCustomerId, { email });
    }

    const internalTest = isInternalAnalyticsRequest(request);
    const attribution = sanitizeAttributionBundle(body?.attribution);
    const checkoutIntent = await createTrialCheckoutIntent({
      anonymousUid: decodedToken.uid,
      normalizedEmail: email,
      internalTest,
      attribution,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : email
          ? { customer_email: email }
          : {}),
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
          normalizedEmail: checkoutIntent.normalizedEmail,
          checkoutIntentId: checkoutIntent.checkoutIntentId,
          trialOffer: "cleartill-7-day-trial",
          planCommitment: "gbp-199-monthly",
          internal_test: internalTest ? "1" : "0",
          ...attributionMetadata(attribution),
        },
      },
      metadata: {
        firebaseUid: decodedToken.uid,
        normalizedEmail: checkoutIntent.normalizedEmail,
        checkoutIntentId: checkoutIntent.checkoutIntentId,
        planCommitment: "gbp-199-monthly-after-7-day-trial",
        internal_test: internalTest ? "1" : "0",
        ...attributionMetadata(attribution),
      },
      allow_promotion_codes: false,
    });

    await attachCheckoutSession(checkoutIntent.checkoutIntentId, session.id);

    await syncSubscriptionState(decodedToken.uid, {
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      stripePriceId: process.env.STRIPE_MONTHLY_PRICE_ID,
      lastCheckoutSessionId: session.id,
      checkoutIntentId: checkoutIntent.checkoutIntentId,
      lastStripeEventAt: Date.now(),
      ...(email ? { customerEmail: email } : {}),
    }, { force: true });
    if (!internalTest) await trackServerAnalyticsEvent("trial_checkout_started", { uid: decodedToken.uid, source: "dashboard" });

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      offerHeadline: runtime.config.offerHeadline,
      offerCopy: runtime.config.offerCopy,
      checkoutCommitmentCopy: runtime.config.checkoutCommitmentCopy,
    });
  } catch (error) {
    const status = error instanceof TrialClaimError
      ? 400
      : error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not start Stripe Checkout." },
      { status },
    );
  }
}
