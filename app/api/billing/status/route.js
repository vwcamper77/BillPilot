import { NextResponse } from "next/server";
import { getBillingRuntimeConfig } from "@/lib/billing/config";
import { getSubscriptionState } from "@/lib/billing/store";
import { verifyRequestUser } from "@/lib/serverAuth";
import { getTrialClaimStatus } from "@/lib/billing/trialClaims.server";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const runtime = getBillingRuntimeConfig();
    const authorization = request.headers.get("authorization");

    if (!authorization) {
      return NextResponse.json({
        ok: true,
        config: runtime.config,
        subscription: null,
        entitlement: null,
      });
    }

    const decodedToken = await verifyRequestUser(request);
    const state = await getSubscriptionState(decodedToken.uid);
    const entitlement = await resolveEntitlementForUid(decodedToken.uid, { accountEmail: decodedToken.email || null });
    const claim = await getTrialClaimStatus({
      uid: decodedToken.uid,
      checkoutIntentId: state.subscription?.checkoutIntentId,
    });

    return NextResponse.json({
      ok: true,
      config: runtime.config,
      subscription: state.subscription,
      entitlement,
      claim,
    });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not load billing status." },
      { status },
    );
  }
}
