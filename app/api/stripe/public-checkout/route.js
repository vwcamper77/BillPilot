import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { FOUNDING_PLAN } from "@/lib/billingAccess";
import { isPublicCheckoutEnabled } from "@/lib/checkoutFlags";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

/**
 * No-auth-required Checkout Session creation for the founding-member offer.
 * The browser supplies nothing that affects price, product, or access
 * duration — those are always server-determined, exactly like the legacy
 * authenticated route. An optional Bearer token from an already signed-in,
 * non-anonymous user is used only to prefill customer_email.
 */
export async function POST(request) {
  if (!isPublicCheckoutEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    await checkRateLimit("public-checkout", getRequestIp(request), { max: 8, windowSeconds: 3600 });

    const body = await request.json().catch(() => ({}));
    const origin = request.nextUrl.origin;
    const stripe = getStripeServerClient();
    const priceId = process.env.STRIPE_PRICE_ID;
    const prefillEmail = await resolvePrefillEmail(request);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      customer_email: prefillEmail || undefined,
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "gbp",
                product_data: {
                  name: "ClearTill Founding Member",
                  description: "90 days of early access for one customer.",
                },
                unit_amount: 500,
              },
              quantity: 1,
            },
          ],
      metadata: {
        plan: FOUNDING_PLAN,
        planKey: "founding_member",
        accessDurationDays: "90",
        offer: "founding_member_2026",
        flow: "public",
        gaClientId: sanitizeClientId(body?.gaClientId),
      },
    });

    if (!session.url) {
      throw new Error("Stripe Checkout did not return a session URL.");
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    return NextResponse.json(
      { error: error?.message || "Could not create a Stripe Checkout session." },
      { status: 500 },
    );
  }
}

function sanitizeClientId(value) {
  const normalized = String(value || "").trim();
  return /^\d+\.\d+$/.test(normalized) ? normalized.slice(0, 64) : "";
}

/** Optional convenience only — never trusted as the fulfilment source of truth. */
async function resolvePrefillEmail(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(match[1]);

    if (decodedToken.firebase?.sign_in_provider === "anonymous") {
      return null;
    }

    return decodedToken.email || null;
  } catch {
    return null;
  }
}
