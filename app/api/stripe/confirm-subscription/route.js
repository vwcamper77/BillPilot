import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import { getSubscriptionState } from "@/lib/billing/store";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await verifyRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId.startsWith("cs_")) {
      return NextResponse.json({ ok: false, error: "Invalid Stripe checkout reference." }, { status: 400 });
    }

    const { subscription } = await getSubscriptionState(user.uid);
    const entitlement = await resolveEntitlementForUid(user.uid, { accountEmail: user.email || null });
    if (subscription?.lastCheckoutSessionId !== sessionId) {
      return NextResponse.json({ ok: false, error: "This checkout belongs to a different account." }, { status: 403 });
    }
    const verifiedStatus = subscription?.subscriptionStatus || "pending";
    const confirmed = ["active", "trialing"].includes(verifiedStatus) && entitlement.hasAccess;

    return NextResponse.json({
      ok: true,
      outcome: confirmed ? "confirmed" : ["past_due", "unpaid", "incomplete_expired", "canceled"].includes(verifiedStatus) ? "failed" : "pending",
      status: verifiedStatus,
      currentPeriodEnd: subscription?.currentPeriodEnd || null,
    });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: status === 401 ? "Sign in again to confirm your subscription." : "Could not confirm the subscription yet." },
      { status },
    );
  }
}
