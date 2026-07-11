import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { hasActiveEntitlement } from "@/lib/entitlementResolver.server";

export const runtime = "nodejs";

export async function GET(request) {
  console.info("[access-check] received access check");

  try {
    const decodedToken = await verifyIdTokenFromRequest(request);
    const uid = String(decodedToken.uid || "").trim();
    const { accessActive, state, entitlement } = await hasActiveEntitlement(uid);

    return NextResponse.json({
      ok: true,
      state,
      accessActive,
      accessStatus: entitlement.status,
      accessUntil: entitlement.accessExpiresAt,
    });
  } catch (error) {
    if (error?.code === "auth/missing-id-token" || error?.code === "auth/invalid-id-token") {
      return NextResponse.json(
        { ok: true, state: "signed_out", accessActive: false },
        { status: 401 },
      );
    }

    console.error("[access-check] access check failed", error);

    return NextResponse.json(
      { ok: false, state: "access_check_error", accessActive: false },
      { status: 500 },
    );
  }
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
