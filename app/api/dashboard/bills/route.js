import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { touchCustomerActivity } from "@/lib/customerProfile.server";
import { recordFirstSaveAndTutorial } from "@/lib/analytics/onboarding.server";
import { assertCanEditFinancialData, isReadOnlyAccessError } from "@/lib/financialAccess.server";
import { recordReminderMeaningfulActivity } from "@/lib/reminders/lifecycle.server";
import { cancelPendingNotificationTypes } from "@/lib/reminders/store.server";
import { NOTIFICATION_TYPES } from "@/lib/reminders/policy";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardBillsRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    await assertCanEditFinancialData(decodedToken.uid, { accountEmail: decodedToken.email || null });
    const userRef = getAdminDb().collection("users").doc(decodedToken.uid).collection("bills");

    console.info("[dashboard-bills] request", {
      action,
      uid: decodedToken.uid,
      billId: body?.billId || null,
    });

    switch (action) {
      case "create_bill": {
        const fields = normaliseFields(body?.fields || {});
        const billRef = userRef.doc();
        await billRef.set({
          ...fields,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await recordFirstSaveAndTutorial({ uid: decodedToken.uid, saveEvent: "bill_added" });
        await recordReminderMeaningfulActivity(decodedToken.uid, "bill_added");
        await cancelPendingBillEmails(decodedToken.uid);

        void touchCustomerActivity({
          uid: decodedToken.uid,
          patch: { billsCount: FieldValue.increment(1), onboardingStatus: "bills_added" },
        });

        return NextResponse.json({
          ok: true,
          action,
          billId: billRef.id,
        });
      }

      case "update_bill": {
        const billId = String(body?.billId || "").trim();
        if (!billId) {
          return NextResponse.json({ ok: false, error: "Missing bill id." }, { status: 400 });
        }

        const fields = normaliseFields(body?.fields || {});
        await userRef.doc(billId).set({
          ...fields,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await recordReminderMeaningfulActivity(decodedToken.uid, "bill_updated");
        await cancelPendingBillEmails(decodedToken.uid);

        return NextResponse.json({ ok: true, action, billId });
      }

      case "delete_bill": {
        const billId = String(body?.billId || "").trim();
        if (!billId) {
          return NextResponse.json({ ok: false, error: "Missing bill id." }, { status: 400 });
        }

        await userRef.doc(billId).delete();
        await recordReminderMeaningfulActivity(decodedToken.uid, "bill_deleted");
        await cancelPendingBillEmails(decodedToken.uid);
        return NextResponse.json({ ok: true, action, billId });
      }

      case "bulk_delete_bills": {
        const billIds = Array.isArray(body?.billIds) ? body.billIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
        if (!billIds.length) {
          return NextResponse.json({ ok: false, error: "No bill ids provided." }, { status: 400 });
        }

        const batch = getAdminDb().batch();
        billIds.forEach((billId) => batch.delete(userRef.doc(billId)));
        await batch.commit();
        await recordReminderMeaningfulActivity(decodedToken.uid, "bills_deleted");
        await cancelPendingBillEmails(decodedToken.uid);

        return NextResponse.json({ ok: true, action, count: billIds.length });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unsupported dashboard bill action." },
          { status: 400 },
        );
    }
  } catch (error) {
    if (isReadOnlyAccessError(error)) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again before saving that bill." },
        { status: 401 },
      );
    }

    console.error("[dashboard-bills] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not save that bill." },
      { status: 500 },
    );
  }
}

function cancelPendingBillEmails(uid) {
  return cancelPendingNotificationTypes(uid, [NOTIFICATION_TYPES.BILL_DUE_TOMORROW, NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE], "bill_lifecycle_changed");
}

async function verifyDashboardBillsRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Unauthorized");
    error.code = "auth/invalid-id-token";
    throw error;
  }
}

function normaliseFields(fields) {
  return Object.fromEntries(
    Object.entries({ ...fields }).map(([key, value]) => [
      key,
      value === "__SERVER_TIMESTAMP__" ? FieldValue.serverTimestamp() : value,
    ]),
  );
}
