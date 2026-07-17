import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";

export const runtime = "nodejs";

/**
 * Retained for compatibility with older clients and existing Stripe-trial
 * records. New checkout creation is intentionally disabled: upgrades now go
 * through /api/stripe/subscription-checkout with an explicit paid plan.
 */
export async function POST(request) {
  try {
    await verifyRequestUser(request);
    return NextResponse.json({
      ok: false,
      code: "legacy_trial_checkout_retired",
      error: "The previous card-based trial is no longer available. Choose a monthly or annual plan from Pricing.",
      pricingPath: "/pricing",
    }, { status: 410 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Please sign in again before choosing a plan." }, { status: 401 });
  }
}
