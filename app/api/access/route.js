import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { hasActiveEntitlement } from "@/lib/entitlementResolver.server";

export const runtime = "nodejs";

export async function GET(request) {
  console.info("[access-check] received access check");

  try {
    const decodedToken = await verifyIdTokenFromRequest(request);
    const uid = String(decodedToken.uid || "").trim();
    const { accessActive, state, entitlement } = await hasActiveEntitlement(uid, { accountEmail: decodedToken.email || null });

    return NextResponse.json({
      ok: true,
      state,
      accessActive,
      accessStatus: entitlement.hasAccess ? "active" : entitlement.reason,
      accessUntil: entitlement.accessExpiresAt,
      entitlement,
    });
  } catch (error) {
    if (error?.code === "auth/missing-id-token" || error?.code === "auth/invalid-id-token") {
      return NextResponse.json(
        { ok: true, state: "signed_out", accessActive: false },
        { status: 401 },
      );
    }

    console.error("[access-check] access check failed", error);

    if (isFirestoreQuotaError(error)) {
      return NextResponse.json(
        {
          ok: false,
          state: "service_unavailable",
          accessActive: false,
          error: "ClearTill is temporarily unable to load account data. Please try again shortly.",
        },
        {
          status: 503,
          headers: { "Retry-After": "300" },
        },
      );
    }

    return NextResponse.json(
      { ok: false, state: "access_check_error", accessActive: false },
      { status: 500 },
    );
  }
}

function isFirestoreQuotaError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error?.details || "").toLowerCase();
  return code === "8"
    || code === "resource-exhausted"
    || code === "resource_exhausted"
    || message.includes("resource_exhausted")
    || message.includes("quota exceeded");
}

async function verifyIdTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Missing Firebase ID token.");
    error.code = "auth/missing-id-token";
    throw error;
  }

  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Invalid Firebase ID token.");
    error.code = "auth/invalid-id-token";
    throw error;
  }
}
