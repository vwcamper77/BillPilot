import { NextResponse } from "next/server";
import { resendAccessEmail, EntitlementClaimedError, InvalidClaimTokenError } from "@/lib/entitlements.server";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

/**
 * Re-sends the access-link email for a still-pending entitlement, rotating
 * the claim token in the process (see lib/entitlements.server.js). Stricter
 * rate limit than /api/access/claim — this sends mail to an address the
 * caller hasn't proven control of yet, so it's the more abuse-prone route.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || body?.sid || "").trim();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing checkout session reference." }, { status: 400 });
    }

    await checkRateLimit("access-resend", `${getRequestIp(request)}:${sessionId}`, { max: 3, windowSeconds: 3600 });

    const result = await resendAccessEmail({ sessionId });

    return NextResponse.json({ sent: true, maskedEmail: result.maskedEmail });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    if (error instanceof InvalidClaimTokenError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }

    if (error instanceof EntitlementClaimedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }

    console.error("[access-resend] unexpected failure", error);
    return NextResponse.json({ error: "Could not resend access link." }, { status: 500 });
  }
}
