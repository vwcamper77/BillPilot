import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { getStripeServerClient } from "@/lib/stripe";
import { FOUNDING_PLAN } from "@/lib/billingAccess";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyCheckoutRequest(request);
    const origin = request.nextUrl.origin;
    const stripe = getStripeServerClient();
    const priceId = process.env.STRIPE_PRICE_ID;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      client_reference_id: decodedToken.uid,
      customer_email: decodedToken.email || undefined,
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancel`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      line_items: priceId
        ? [
            {
              price: priceId,
              quantity: 1,
            },
          ]
        : [
            {
              price_data: {
                currency: "gbp",
                product_data: {
                  name: "ClearTill Founding Member",
                  description: "3 months of early access for one customer.",
                },
                unit_amount: 500,
              },
              quantity: 1,
            },
          ],
      metadata: {
        userId: decodedToken.uid,
        userEmail: decodedToken.email || "",
        plan: FOUNDING_PLAN,
      },
    });

    if (!session.url) {
      throw new Error("Stripe Checkout did not return a session URL.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
      || error?.code === "auth/anonymous-not-allowed"
    ) {
      return NextResponse.json(
        { error: error?.message || "Please sign in before starting checkout." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: error?.message || "Could not create a Stripe Checkout session.",
      },
      { status: 500 }
    );
  }
}

async function verifyCheckoutRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Please sign in before starting checkout.");
    error.code = "auth/missing-id-token";
    throw error;
  }

  let decodedToken;

  try {
    decodedToken = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Please sign in again before starting checkout.");
    error.code = "auth/invalid-id-token";
    throw error;
  }

  if (decodedToken.firebase?.sign_in_provider === "anonymous") {
    const error = new Error("Guest sessions cannot be used for checkout. Sign in with email, password, or Google first.");
    error.code = "auth/anonymous-not-allowed";
    throw error;
  }

  if (!decodedToken.uid || !decodedToken.email) {
    const error = new Error("Checkout requires a signed-in account with an email address.");
    error.code = "auth/invalid-id-token";
    throw error;
  }

  return decodedToken;
}
