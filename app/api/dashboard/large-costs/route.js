import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardLargeCostsRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const userRef = getAdminDb().collection("users").doc(decodedToken.uid).collection("largeCosts");

    console.info("[dashboard-large-costs] request", {
      action,
      uid: decodedToken.uid,
      costId: body?.costId || null,
    });

    switch (action) {
      case "save_large_cost": {
        const costId = String(body?.costId || "").trim();
        const fields = normaliseFields(body?.fields || {});
        const costRef = costId ? userRef.doc(costId) : userRef.doc();
        const snapshot = await costRef.get();

        await costRef.set({
          ...fields,
          updatedAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        }, { merge: true });

        return NextResponse.json({
          ok: true,
          action,
          costId: costRef.id,
        });
      }

      case "delete_large_cost": {
        const costId = String(body?.costId || "").trim();
        if (!costId) {
          return NextResponse.json({ ok: false, error: "Missing large cost id." }, { status: 400 });
        }

        await userRef.doc(costId).delete();
        return NextResponse.json({ ok: true, action, costId });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unsupported dashboard large cost action." },
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
        { ok: false, error: "Please sign in again before saving that large cost." },
        { status: 401 },
      );
    }

    console.error("[dashboard-large-costs] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not save that large cost." },
      { status: 500 },
    );
  }
}

async function verifyDashboardLargeCostsRequest(request) {
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
