import { NextResponse } from "next/server";
import {
  EntitlementExpiredError,
  InvalidClaimTokenError,
  resolveClaimEmail,
} from "@/lib/entitlements.server";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

/**
 * Lets /access/claim sign the visitor in without asking them to retype
 * their email — gated purely on proving possession of the correct claim
 * token (the same bearer secret the link itself already is).
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || "").trim();
    const claimToken = typeof body?.claimToken === "string" ? body.claimToken : "";

    if (!sessionId || !claimToken) {
      return NextResponse.json({ error: "Missing link details." }, { status: 400 });
    }

    await checkRateLimit("claim-email", `${getRequestIp(request)}:${sessionId}`, { max: 15, windowSeconds: 3600 });

    const { email } = await resolveClaimEmail({ sessionId, claimToken });
    return NextResponse.json({ email });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof InvalidClaimTokenError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof EntitlementExpiredError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 410 });
    }

    console.error("[claim-email] unexpected failure", error);
    return NextResponse.json({ error: "Could not resolve this link." }, { status: 500 });
  }
}
