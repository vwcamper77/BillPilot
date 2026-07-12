import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { getMonthlySubscriptionPriceId, isSubscriptionTrialEnabled } from "@/lib/subscriptionFlags";
import { BLOCKING_SUBSCRIPTION_STATUSES } from "@/lib/subscriptionState";
import { hasActiveEntitlement } from "@/lib/entitlementResolver.server";
import { buildSubscriptionCheckoutParams } from "@/lib/subscriptionCheckout";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isSubscriptionTrialEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const user = await verifyRequest(request);
    const [customerSnapshot, access] = await Promise.all([
      getAdminDb().collection("customers").doc(user.uid).get(),
      hasActiveEntitlement(user.uid),
    ]);
    const customer = customerSnapshot.exists ? customerSnapshot.data() : {};

    if (access.accessActive && access.entitlement?.billingMode !== "subscription") {
      return NextResponse.json({ error: "Your existing ClearTill access is already active." }, { status: 409 });
    }
    if (customer.stripeSubscriptionId && BLOCKING_SUBSCRIPTION_STATUSES.has(customer.subscriptionStatus)) {
      return NextResponse.json({ error: "A subscription already exists. Manage it from your account." }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const stripe = getStripeServerClient();
    const origin = request.nextUrl.origin;
    const stripeCustomerId = String(customer.stripeCustomerId || "").trim();
    const session = await stripe.checkout.sessions.create(buildSubscriptionCheckoutParams({
      uid: user.uid, email: user.email, priceId: getMonthlySubscriptionPriceId(), origin,
      stripeCustomerId, gaClientId: sanitizeClientId(body?.gaClientId),
    }));

    if (!session.url) throw new Error("Stripe Checkout did not return a session URL.");
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    if (error?.code?.startsWith("auth/")) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error?.code === "subscription/configuration") {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[subscription-checkout] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ error: "Could not start the free trial right now." }, { status: 500 });
  }
}

async function verifyRequest(request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw authError("auth/missing-id-token", "Please sign in before starting your trial.");
  let decoded;
  try { decoded = await getAdminAuth().verifyIdToken(match[1]); } catch { throw authError("auth/invalid-id-token", "Please sign in again before starting your trial."); }
  if (decoded.firebase?.sign_in_provider === "anonymous" || !decoded.uid || !decoded.email || !decoded.email_verified) {
    throw authError("auth/unverified-account", "Use a verified email account before starting your trial.");
  }
  return decoded;
}

function authError(code, message) { const error = new Error(message); error.code = code; return error; }
function sanitizeClientId(value) { const text = String(value || "").trim(); return /^\d+\.\d+$/.test(text) ? text.slice(0, 64) : ""; }
