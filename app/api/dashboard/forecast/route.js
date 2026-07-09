import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { touchCustomerActivity } from "@/lib/customerProfile.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardForecastRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const amount = Number(body?.amount);
    const payDay = Number(body?.payDay);

    console.info("[dashboard-forecast] request", {
      action,
      uid: decodedToken.uid,
      amount,
      payDay,
    });

    if (action !== "save_forecast") {
      return NextResponse.json(
        { ok: false, error: "Unsupported dashboard forecast action." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json(
        { ok: false, error: "Enter your monthly income amount." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      return NextResponse.json(
        { ok: false, error: "Enter a payday between 1 and 31." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(decodedToken.uid);
    const incomeRef = userRef.collection("income").doc("main");
    const [userSnapshot, incomeSnapshot] = await Promise.all([
      userRef.get(),
      incomeRef.get(),
    ]);

    await Promise.all([
      userRef.set({
        expectedPay: amount,
        payday: payDay,
        updatedAt: FieldValue.serverTimestamp(),
        ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true }),
      incomeRef.set({
        name: "Payday",
        amount,
        payDay,
        currency: "GBP",
        updatedAt: FieldValue.serverTimestamp(),
        ...(incomeSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true }),
    ]);

    void touchCustomerActivity({ uid: decodedToken.uid, patch: { onboardingStatus: "payday_added" } });

    return NextResponse.json({
      ok: true,
      action,
      expectedPay: amount,
      payday: payDay,
    });
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again before saving your forecast settings." },
        { status: 401 },
      );
    }

    console.error("[dashboard-forecast] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not save your forecast settings." },
      { status: 500 },
    );
  }
}

async function verifyDashboardForecastRequest(request) {
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
