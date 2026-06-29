import { NextResponse } from "next/server";
import { deleteUserAccount, deleteUserData, resetUserData } from "@/lib/accountData";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyAccountRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    switch (action) {
      case "reset_data": {
        const result = await resetUserData(decodedToken.uid);

        return NextResponse.json({
          ok: true,
          action,
          message: "ClearTill data reset.",
          ...result,
        });
      }

      case "delete_data": {
        const result = await deleteUserData(decodedToken.uid);

        return NextResponse.json({
          ok: true,
          action,
          message: "All ClearTill data deleted.",
          ...result,
        });
      }

      case "delete_account": {
        // TODO: Cancel or disconnect Stripe billing before full account deletion when paid plans exist.
        const result = await deleteUserAccount(decodedToken.uid);

        return NextResponse.json({
          ok: true,
          action,
          message: "Account deleted.",
          ...result,
        });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unsupported account action." },
          { status: 400 },
        );
    }
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again before trying that account action." },
        { status: 401 },
      );
    }

    console.error("[account] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not complete that account action." },
      { status: 500 },
    );
  }
}

async function verifyAccountRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  return getAdminAuth().verifyIdToken(match[1]);
}
