import { NextResponse } from "next/server";
import { grantFoundingAccessFromCheckoutSession } from "@/lib/billingAccess.server";
import { getStripeServerClient } from "@/lib/stripe";

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

  try {
    const payload = await request.text();
    const event = getStripeServerClient().webhooks.constructEvent(payload, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      await grantFoundingAccessFromCheckoutSession(event.data.object);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Stripe webhook handling failed." },
      { status: 400 },
    );
  }
}
