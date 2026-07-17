import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { getSubscriptionPriceId } from "@/lib/subscriptionFlags";
import { BLOCKING_SUBSCRIPTION_STATUSES } from "@/lib/subscriptionState";
import { hasActiveEntitlement } from "@/lib/entitlementResolver.server";
import { buildSubscriptionCheckoutParams } from "@/lib/subscriptionCheckout";
import { isInternalAnalyticsRequest } from "@/lib/analytics/internal.server";
import { sanitizeAttributionBundle } from "@/lib/analytics/attribution.server";
import { trackServerAnalyticsEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const plan = String(body?.plan || "").trim().toLowerCase();
    if (!["monthly", "annual"].includes(plan)) {
      return NextResponse.json({ error: "Choose either the monthly or annual plan." }, { status: 400 });
    }
    const priceId = getSubscriptionPriceId(plan);
    const [customerSnapshot, access] = await Promise.all([
      getAdminDb().collection("customers").doc(user.uid).get(),
      hasActiveEntitlement(user.uid),
    ]);
    const customer = customerSnapshot.exists ? customerSnapshot.data() : {};

    if ((access.entitlement.hasAccess && access.entitlement.accessType !== "no_card_preview")
      || access.entitlement.preventsDuplicateCheckout
      || (customer.stripeSubscriptionId && BLOCKING_SUBSCRIPTION_STATUSES.has(customer.subscriptionStatus))) {
      return NextResponse.json({ error: access.accessActive
        ? "Your existing ClearTill access is already active."
        : "A payment or subscription is already in progress. Manage it from your account." }, { status: 409 });
    }

    if (access.entitlement.canStartPreview) {
      return NextResponse.json({ error: "Save your first complete ClearTill position before choosing a paid plan." }, { status: 409 });
    }

    const stripe = getStripeServerClient();
    const origin = request.nextUrl.origin;
    const stripeCustomerId = String(access.entitlement.stripeCustomerId || customer.stripeCustomerId || "").trim();
    const attribution = sanitizeAttributionBundle(body?.attribution);
    if (attribution) {
      await getAdminDb().collection("customers").doc(user.uid).set({
        attribution: customer.attribution || attribution,
        firstTouchAttribution: customer.firstTouchAttribution || attribution.firstTouch,
        lastTouchAttribution: attribution.lastTouch,
      }, { merge: true });
    }
    const session = await stripe.checkout.sessions.create(buildSubscriptionCheckoutParams({
      uid: user.uid, email: user.email, priceId, plan, origin,
      stripeCustomerId, gaClientId: sanitizeClientId(body?.gaClientId),
      internalTest: isInternalAnalyticsRequest(request), attribution,
    }));

    if (!session.url) throw new Error("Stripe Checkout did not return a session URL.");
    await trackServerAnalyticsEvent("upgrade_checkout_started", { uid: user.uid, source: plan });
    return NextResponse.json({ url: session.url, sessionId: session.id, plan, terms: plan === "annual" ? "£24.99 per year, paid upfront" : "£3.99 per month until cancelled" });
  } catch (error) {
    if (error?.code?.startsWith("auth/")) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error?.code === "subscription/configuration") {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error?.code === "subscription/invalid-plan") return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[subscription-checkout] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ error: "Could not start secure checkout right now." }, { status: 500 });
  }
}

async function verifyRequest(request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw authError("auth/missing-id-token", "Please sign in before choosing a plan.");
  let decoded;
  try { decoded = await getAdminAuth().verifyIdToken(match[1]); } catch { throw authError("auth/invalid-id-token", "Please sign in again before choosing a plan."); }
  if (decoded.firebase?.sign_in_provider === "anonymous" || !decoded.uid || !decoded.email || !decoded.email_verified) {
    throw authError("auth/unverified-account", "Use a verified email account before choosing a plan.");
  }
  return decoded;
}

function authError(code, message) { const error = new Error(message); error.code = code; return error; }
function sanitizeClientId(value) { const text = String(value || "").trim(); return /^\d+\.\d+$/.test(text) ? text.slice(0, 64) : ""; }
