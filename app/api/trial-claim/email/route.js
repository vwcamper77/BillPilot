import { NextResponse } from "next/server";
import { resolveTrialClaimEmail, TrialClaimError } from "@/lib/billing/trialClaims.server";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const checkoutIntentId = String(body?.checkoutIntentId || "").trim();
    const claimToken = String(body?.claimToken || "").trim();
    if (!checkoutIntentId || !claimToken) {
      return NextResponse.json({ ok: false, error: "This secure link is not valid." }, { status: 400 });
    }
    await checkRateLimit("trial-claim-email", `${getRequestIp(request)}:${checkoutIntentId}`, { max: 15, windowSeconds: 3600 });
    const { email } = await resolveTrialClaimEmail({ checkoutIntentId, claimToken });
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429 });
    if (error instanceof TrialClaimError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "link_expired" ? 410 : 400 });
    }
    return NextResponse.json({ ok: false, error: "This secure link could not be verified." }, { status: 500 });
  }
}
