import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { grantFoundingAccessByEmail } from "@/lib/billingAccess.server";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const decodedToken = await verifyIdTokenFromRequest(request);
    return NextResponse.json({ ok: true, isAdmin: isAdminEmail(decodedToken.email) });
  } catch {
    return NextResponse.json({ ok: true, isAdmin: false });
  }
}

export async function POST(request) {
  try {
    const decodedToken = await verifyAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const targetEmail = String(body?.email || "").trim().toLowerCase();

    if (!targetEmail) {
      return NextResponse.json(
        { ok: false, error: "Email is required." },
        { status: 400 },
      );
    }

    await grantFoundingAccessByEmail(targetEmail);

    return NextResponse.json({
      ok: true,
      message: `Founding access granted to ${targetEmail}.`,
      adminEmail: decodedToken.email || "",
    });
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again before trying that admin action." },
        { status: 401 },
      );
    }

    if (error?.code === "auth/forbidden") {
      return NextResponse.json(
        { ok: false, error: "You are not allowed to use the founding access override." },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not grant founding access." },
      { status: 500 },
    );
  }
}

function isAdminEmail(email) {
  const allowedEmails = new Set(
    String(process.env.FOUNDING_ACCESS_ADMIN_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return Boolean(normalizedEmail) && allowedEmails.has(normalizedEmail);
}

async function verifyAdminRequest(request) {
  const decodedToken = await verifyIdTokenFromRequest(request);

  if (!isAdminEmail(decodedToken.email)) {
    const error = new Error("Forbidden");
    error.code = "auth/forbidden";
    throw error;
  }

  return decodedToken;
}

async function verifyIdTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  return getAdminAuth().verifyIdToken(match[1]);
}
