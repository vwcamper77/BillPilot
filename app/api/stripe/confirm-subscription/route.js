import { NextResponse } from "next/server";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { syncStripeSubscriptionToFirestore } from "@/lib/billing/subscriptionSync";
import { getStripeClient } from "@/lib/billing/stripe";
import { verifyRequestUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await verifyRequestUser(request);
    const runtime = getBillingRuntimeConfig();
    if (!runtime.config.enabled) {
      return NextResponse.json({ ok: false, error: "Subscription trial is not enabled." }, { status: 409 });
    }
    if (!runtime.ok) {
      return NextResponse.json({ ok: false, error: runtime.message }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId.startsWith("cs_")) {
      return NextResponse.json({ ok: false, error: "Invalid Stripe checkout reference." }, { status: 400 });
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription.latest_invoice"],
    });
    if (session.status !== "complete" || session.mode !== "subscription") {
      return NextResponse.json({ ok: false, error: "Stripe checkout is not complete." }, { status: 409 });
    }
    if (session.metadata?.firebaseUid !== user.uid) {
      return NextResponse.json({ ok: false, error: "This checkout belongs to a different account." }, { status: 403 });
    }

    if (!session.subscription) {
      return NextResponse.json({ ok: false, error: "Stripe did not create the subscription." }, { status: 409 });
    }

    const subscription = typeof session.subscription === "object"
      ? session.subscription
      : await stripe.subscriptions.retrieve(session.subscription, { expand: ["latest_invoice"] });
    await syncStripeSubscriptionToFirestore({
      uid: user.uid,
      subscription,
      customerEmail: user.email || session.customer_details?.email || "",
      extras: {
        checkoutCompletedAt: Date.now(),
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || "",
      },
    });

    return NextResponse.json({
      ok: true,
      status: subscription.status,
      trialEnd: subscription.trial_end ? subscription.trial_end * 1000 : null,
    });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: status === 401 ? "Sign in again to confirm your trial." : "Could not confirm the trial yet." },
      { status },
    );
  }
}
