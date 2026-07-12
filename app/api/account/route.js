import { NextResponse } from "next/server";
import { deleteUserAccount, deleteUserData, exportUserData, resetUserData } from "@/lib/accountData";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { logSecurityEvent, SECURITY_ACTIONS } from "@/lib/security/auditLog";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";
import { BLOCKING_SUBSCRIPTION_STATUSES } from "@/lib/subscriptionState";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const decodedToken = await verifyAccountRequest(request);
    const resolved = await resolveEntitlementForUid(decodedToken.uid, {
      accountEmail: decodedToken.email || null,
    });
    return NextResponse.json({ ok: true, billing: resolved.response });
  } catch (error) {
    if (error?.code?.startsWith("auth/")) {
      return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    }
    console.error("[account] billing read failed", error);
    return NextResponse.json({ ok: false, error: "Could not load billing access." }, { status: 500 });
  }
}

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
        const customerSnapshot = await getAdminDb().collection("customers").doc(decodedToken.uid).get();
        const customer = customerSnapshot.exists ? customerSnapshot.data() : {};
        if (customer.stripeSubscriptionId && BLOCKING_SUBSCRIPTION_STATUSES.has(customer.subscriptionStatus)) {
          return NextResponse.json({
            ok: false,
            error: "Manage and cancel your subscription before deleting your account.",
          }, { status: 409 });
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
