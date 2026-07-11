import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import {
  claimPendingEntitlement,
  EmailMismatchError,
  EntitlementClaimedError,
  EntitlementExpiredError,
  hashClaimToken,
  InvalidClaimTokenError,
} from "@/lib/entitlements.server";
import { FOUNDING_ITEM, sendGa4Event } from "@/lib/analytics/ga4.server";
import { checkRateLimit, getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";

export const runtime = "nodejs";

/**
 * Two entry points converge here:
 *  - email-link claim: body carries { claimToken, sessionId } — the caller
 *    just completed Firebase signInWithEmailLink using a link containing
 *    both. We verify sha256(claimToken) against the stored activeTokenHash
 *    before ever touching the entitlement.
 *  - already-authenticated success-page claim: body carries only
 *    { sessionId } — no token. The security boundary is the email-match
 *    check inside claimPendingEntitlement itself, gated on the caller
 *    already holding a real (non-anonymous) Firebase session.
 */
export async function POST(request) {
  try {
    const decodedToken = await verifyCaller(request);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || body?.sid || "").trim();
    const claimToken = typeof body?.claimToken === "string" ? body.claimToken : null;
    const isNewUser = Boolean(body?.isNewUser);

    if (!sessionId) {
      return NextResponse.json({ error: "Missing checkout session reference." }, { status: 400 });
    }

    await checkRateLimit("access-claim", `${getRequestIp(request)}:${sessionId}`, { max: 15, windowSeconds: 3600 });

    if (claimToken) {
      const entitlement = await getAdminDb().collection("pendingEntitlements").doc(sessionId).get();
      const activeTokenHash = entitlement.exists ? entitlement.data()?.activeTokenHash : null;

      if (!activeTokenHash || hashClaimToken(claimToken) !== activeTokenHash) {
        throw new InvalidClaimTokenError();
      }
    }

    if (decodedToken.email_verified !== true) {
      const error = new Error("Verify your email before claiming access.");
      error.code = "auth/email-not-verified";
      throw error;
    }

    const result = await claimPendingEntitlement({
      sessionId,
      uid: decodedToken.uid,
      verifiedEmail: decodedToken.email,
    });

    if (!result.alreadyClaimed) {
      await sendGa4Event({
        eventName: isNewUser ? "sign_up" : "login",
        userId: decodedToken.uid,
        params: {},
      }).catch((error) => console.error("[access-claim] ga4 sign_up/login failed", error));

      await sendGa4Event({
        eventName: "entitlement_claimed",
        userId: decodedToken.uid,
        params: {
          value: result.entitlement.isQaPurchase ? 0 : (Number(result.entitlement.amountPaid) || 0) / 100,
          currency: String(result.entitlement.currency || "gbp").toUpperCase(),
          items: [FOUNDING_ITEM],
        },
      }).catch((error) => console.error("[access-claim] ga4 entitlement_claimed failed", error));
    }

    return NextResponse.json({ claimed: true });
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

    if (error instanceof EntitlementClaimedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }

    if (error instanceof EmailMismatchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }

    if (error?.code === "auth/missing-id-token" || error?.code === "auth/invalid-id-token" || error?.code === "auth/anonymous-not-allowed" || error?.code === "auth/email-not-verified") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    console.error("[access-claim] unexpected failure", error);
    return NextResponse.json({ error: "Could not activate access." }, { status: 500 });
  }
}

async function verifyCaller(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Please sign in to claim your access.");
    error.code = "auth/missing-id-token";
    throw error;
  }

  let decodedToken;

  try {
    decodedToken = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Please sign in again to claim your access.");
    error.code = "auth/invalid-id-token";
    throw error;
  }

  if (decodedToken.firebase?.sign_in_provider === "anonymous" || !decodedToken.email) {
    const error = new Error("A verified email account is required to claim access.");
    error.code = "auth/anonymous-not-allowed";
    throw error;
  }

  return decodedToken;
}
