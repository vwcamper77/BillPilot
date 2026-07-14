import { NextResponse } from "next/server";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { getStripeClient } from "@/lib/billing/stripe";
import { verifyRequestUser } from "@/lib/serverAuth";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyRequestUser(request);
    const runtime = getBillingRuntimeConfig();

    if (!runtime.ok) {
      return NextResponse.json(
        { ok: false, error: runtime.message, code: runtime.code },
        { status: 503 },
      );
    }

    const entitlement = await resolveEntitlementForUid(decodedToken.uid, { accountEmail: decodedToken.email || null });
    const customerId = entitlement.stripeCustomerId || "";

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "No subscription owner was found for this account." },
        { status: 404 },
      );
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${runtime.config.baseUrl}/account`,
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not open the subscription portal." },
      { status },
    );
  }
}
