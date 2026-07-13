import { NextResponse } from "next/server";
import { claimTrialSubscription, TrialClaimError } from "@/lib/billing/trialClaims.server";
import { verifyRequestUser } from "@/lib/serverAuth";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";
import { getStripeClient } from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const authenticatedUser = await verifyRequestUser(request);
    if (!authenticatedUser.email || authenticatedUser.email_verified !== true) {
      return NextResponse.json({ ok: false, error: "A verified email-link sign-in is required." }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const checkoutIntentId = String(body?.checkoutIntentId || "").trim();
    const claimToken = String(body?.claimToken || "").trim();
    if (!checkoutIntentId || !claimToken) {
      return NextResponse.json({ ok: false, error: "This secure link is not valid." }, { status: 400 });
    }
    await checkRateLimit("trial-claim", `${getRequestIp(request)}:${checkoutIntentId}`, { max: 15, windowSeconds: 3600 });
    const result = await claimTrialSubscription({
      checkoutIntentId,
      claimToken,
      authenticatedUid: authenticatedUser.uid,
      authenticatedEmail: authenticatedUser.email,
    });
    const stripe = getStripeClient();
    await stripe.subscriptions.update(result.stripeSubscriptionId, {
      metadata: { firebaseUid: authenticatedUser.uid },
    });
    if (result.stripeCustomerId) {
      await stripe.customers.update(result.stripeCustomerId, {
        email: authenticatedUser.email,
        metadata: { firebaseUid: authenticatedUser.uid },
      });
    }
    return NextResponse.json({ ok: true, claimed: true, alreadyClaimed: result.alreadyClaimed });
  } catch (error) {
    if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429 });
    if (error instanceof TrialClaimError) {
      const status = error.code === "email_mismatch" || error.code === "invalid_owner" ? 403
        : error.code === "link_expired" ? 410
          : error.code === "subscription_conflict" ? 409 : 400;
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ ok: false, error: "ClearTill could not secure this account." }, { status: 500 });
  }
}
