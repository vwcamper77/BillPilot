import { NextResponse } from "next/server";
import { resendTrialClaimEmail, TrialClaimError } from "@/lib/billing/trialClaims.server";
import { verifyRequestUser } from "@/lib/serverAuth";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const authenticatedUser = await verifyRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const checkoutIntentId = String(body?.checkoutIntentId || "").trim();
    if (!checkoutIntentId) return NextResponse.json({ ok: false, error: "Secure-link request was not found." }, { status: 400 });
    await checkRateLimit("trial-claim-resend", `${getRequestIp(request)}:${checkoutIntentId}`, { max: 3, windowSeconds: 3600 });
    const result = await resendTrialClaimEmail({ checkoutIntentId, anonymousUid: authenticatedUser.uid });
    return NextResponse.json({ ok: true, sent: true, maskedEmail: result.maskedEmail });
  } catch (error) {
    if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429 });
    if (error instanceof TrialClaimError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "invalid_owner" ? 403 : 400 });
    }
    return NextResponse.json({ ok: false, error: "ClearTill could not resend the secure link." }, { status: 500 });
  }
}
