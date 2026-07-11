import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardStateRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (action !== "load_state") {
      return NextResponse.json(
        { ok: false, error: "Unsupported dashboard state action." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(decodedToken.uid);

    console.info("[dashboard-state] request", {
      action,
      uid: decodedToken.uid,
    });

    const [
      balanceSnapshot,
      incomeSnapshot,
      incomeEventsSnapshot,
      savingsSnapshot,
      preferencesSnapshot,
      billsSnapshot,
      largeCostsSnapshot,
      remindersSnapshot,
    ] = await Promise.all([
      userRef.collection("settings").doc("balance").get(),
      userRef.collection("income").doc("main").get(),
      userRef.collection("incomeEvents").where("active", "==", true).get(),
      userRef.collection("settings").doc("savings").get(),
      userRef.collection("settings").doc("preferences").get(),
      userRef.collection("bills").where("active", "==", true).get(),
      userRef.collection("largeCosts").where("active", "==", true).get(),
      userRef.collection("reminders").orderBy("createdAt", "desc").limit(5).get(),
    ]);

    return NextResponse.json({
      ok: true,
      action,
      balance: balanceSnapshot.exists ? serialiseDoc(balanceSnapshot) : null,
      income: incomeSnapshot.exists ? serialiseDoc(incomeSnapshot) : null,
      incomeEvents: incomeEventsSnapshot.docs.map(serialiseDoc),
      savings: savingsSnapshot.exists ? serialiseDoc(savingsSnapshot) : null,
      preferences: preferencesSnapshot.exists ? serialiseDoc(preferencesSnapshot) : null,
      bills: billsSnapshot.docs.map(serialiseDoc),
      largeCosts: largeCostsSnapshot.docs.map(serialiseDoc),
      reminders: remindersSnapshot.docs.map(serialiseDoc),
    });
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json(
        { ok: false, error: "Please sign in again before loading your dashboard." },
        { status: 401 },
      );
    }

    console.error("[dashboard-state] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not load your dashboard." },
      { status: 500 },
    );
  }
}

async function verifyDashboardStateRequest(request) {
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

function serialiseDoc(snapshot) {
  return {
    id: snapshot.id,
    ...serialiseValue(snapshot.data()),
  };
}

function serialiseValue(value) {
  if (Array.isArray(value)) {
    return value.map(serialiseValue);
  }

  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serialiseValue(nestedValue)]),
    );
  }

  return value;
}
