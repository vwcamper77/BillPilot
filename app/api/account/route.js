import { NextResponse } from "next/server";
import { deleteUserAccount, deleteUserData, exportUserData, resetUserData } from "@/lib/accountData";
import { getSubscriptionState } from "@/lib/billing/store";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { logSecurityEvent, SECURITY_ACTIONS } from "@/lib/security/auditLog";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyAccountRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    switch (action) {
      case "export_data": {
        const result = await exportUserData(decodedToken.uid);
        await logSecurityEvent({
          userId: decodedToken.uid,
          action: SECURITY_ACTIONS.DATA_EXPORT_REQUESTED,
        });

        return NextResponse.json({
          ok: true,
          action,
          message: "ClearTill data export ready.",
          export: result,
        });
      }

      case "reset_data": {
        const result = await resetUserData(decodedToken.uid);
        await logSecurityEvent({
          userId: decodedToken.uid,
          action: SECURITY_ACTIONS.DATA_RESET_REQUESTED,
        });

        return NextResponse.json({
          ok: true,
          action,
          message: "ClearTill data reset.",
          ...result,
        });
      }

      case "delete_data": {
        const result = await deleteUserData(decodedToken.uid);
        await logSecurityEvent({
          userId: decodedToken.uid,
          action: SECURITY_ACTIONS.DATA_RESET_REQUESTED,
          metadata: { scope: "all" },
        });

        return NextResponse.json({
          ok: true,
          action,
          message: "All ClearTill data deleted.",
          ...result,
        });
      }

      case "delete_account": {
        const { subscription } = await getSubscriptionState(decodedToken.uid);
        if (subscription?.stripeCustomerId) {
          return NextResponse.json(
            {
              ok: false,
              error: "Manage or cancel your subscription in Billing & payments before deleting this account.",
            },
            { status: 409 },
          );
        }
        // Log the request before deletion so the audit trail survives the account removal.
        await logSecurityEvent({
          userId: decodedToken.uid,
          action: SECURITY_ACTIONS.ACCOUNT_DELETE_REQUESTED,
        });
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
