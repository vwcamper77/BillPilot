import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { touchCustomerActivity } from "@/lib/customerProfile.server";
import { recordFirstSaveAndTutorial } from "@/lib/analytics/onboarding.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardSettingsRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const db = getAdminDb();

    console.info("[dashboard-settings] request", {
      action,
      uid: decodedToken.uid,
    });

    switch (action) {
      case "save_balance": {
        const balanceRef = db.collection("users").doc(decodedToken.uid).collection("settings").doc("balance");
        const currentBalance = body?.currentBalance;
        const currency = String(body?.currency || "GBP").trim() || "GBP";
        const payload = {
          currentBalance: currentBalance === null ? null : Number(currentBalance),
          currency,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (body?.snapshotEntered) {
          payload.snapshotEnteredAt = FieldValue.serverTimestamp();
        }

        const existingSnapshot = await balanceRef.get();
        if (!existingSnapshot.exists) {
          payload.createdAt = FieldValue.serverTimestamp();
        }

        await balanceRef.set(payload, { merge: true });

        await recordFirstSaveAndTutorial({ uid: decodedToken.uid, saveEvent: "balance_added" });

        void touchCustomerActivity({ uid: decodedToken.uid, patch: { onboardingStatus: "balance_added" } });

        return NextResponse.json({ ok: true, action });
      }

      case "save_savings": {
        const savingsRef = db.collection("users").doc(decodedToken.uid).collection("settings").doc("savings");
        const totalSetAside = Number(body?.totalSetAside || 0);

        if (!Number.isFinite(totalSetAside) || totalSetAside < 0) {
          return NextResponse.json(
            { ok: false, error: "Savings not assigned to a big cost must be zero or more." },
            { status: 400 },
          );
        }

        const existingSnapshot = await savingsRef.get();
        await savingsRef.set({
          totalSetAside,
          updatedAt: FieldValue.serverTimestamp(),
          ...(existingSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        }, { merge: true });

        return NextResponse.json({ ok: true, action });
      }

      case "save_preferences": {
        const preferencesRef = db.collection("users").doc(decodedToken.uid).collection("settings").doc("preferences");
        const currency = String(body?.currency || "GBP").trim() || "GBP";
        const existingSnapshot = await preferencesRef.get();
        const payload = {
          currency,
          updatedAt: FieldValue.serverTimestamp(),
          ...(existingSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        };

        await preferencesRef.set(payload, { merge: true });

        return NextResponse.json({ ok: true, action });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unsupported dashboard settings action." },
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
        { ok: false, error: "Please sign in again before saving that setting." },
        { status: 401 },
      );
    }

    console.error("[dashboard-settings] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not save that setting." },
      { status: 500 },
    );
  }
}

async function verifyDashboardSettingsRequest(request) {
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
