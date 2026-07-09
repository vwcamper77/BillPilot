import { NextResponse } from "next/server";
import { getAccessExpiryDate } from "@/lib/billingAccess";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request) {
  console.info("[access-check] received access check");

  try {
    const decodedToken = await verifyIdTokenFromRequest(request);
    const uid = String(decodedToken.uid || "").trim();
    const userDocPath = `users/${uid}`;

    console.info("[access-check] uid verified", { uid });
    console.info("[access-check] reading user access doc", { path: userDocPath });

    const snapshot = await getAdminDb().collection("users").doc(uid).get();

    if (!snapshot.exists) {
      console.info("[access-check] user access doc not found", {
        path: userDocPath,
        accessActive: false,
      });

      return NextResponse.json({
        ok: true,
        state: "access_missing",
        accessActive: false,
      });
    }

    const accessRecord = snapshot.data() || {};
    const rawAccessUntil = accessRecord.accessUntil ?? null;
    const parsedAccessUntil = getAccessExpiryDate(accessRecord);
    const accessActive = Boolean(parsedAccessUntil && parsedAccessUntil.getTime() > Date.now());
    const state = accessActive
      ? "access_active"
      : parsedAccessUntil
        ? "access_expired"
        : "access_missing";

    console.info("[access-check] user access doc found", {
      path: userDocPath,
      accessStatus: accessRecord.accessStatus || null,
      accessUntilRaw: rawAccessUntil,
      accessUntilParsed: parsedAccessUntil ? parsedAccessUntil.toISOString() : null,
      accessActive,
      state,
    });

    return NextResponse.json({
      ok: true,
      state,
      accessActive,
      accessStatus: accessRecord.accessStatus || null,
      accessUntil: parsedAccessUntil ? parsedAccessUntil.toISOString() : null,
      stripeCheckoutSessionId: accessRecord.stripeCheckoutSessionId || null,
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
