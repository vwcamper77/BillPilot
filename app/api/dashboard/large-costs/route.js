import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const decodedToken = await verifyDashboardLargeCostsRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const db = getAdminDb();
    const userDocRef = db.collection("users").doc(decodedToken.uid);
    const userRef = userDocRef.collection("largeCosts");
    const savingsRef = userDocRef.collection("settings").doc("savings");

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
        let savingsTotalSetAside = 0;

        await db.runTransaction(async (transaction) => {
          const [snapshot, savingsSnapshot] = await Promise.all([
            transaction.get(costRef),
            transaction.get(savingsRef),
          ]);
          const oldSavingsContribution = getSavingsContribution(snapshot.exists ? snapshot.data() : {});
          const newSavingsContribution = getSavingsContribution(fields);
          const currentUnassignedSavings = Math.max(0, money(savingsSnapshot.data()?.totalSetAside));
          const savingsDelta = money(newSavingsContribution - oldSavingsContribution);
          savingsTotalSetAside = money(currentUnassignedSavings - savingsDelta);

          if (savingsTotalSetAside < 0) {
            const error = new Error("That savings allocation exceeds your available savings.");
            error.code = "large-cost/insufficient-savings";
            throw error;
          }

          transaction.set(costRef, {
            ...fields,
            updatedAt: FieldValue.serverTimestamp(),
            ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          }, { merge: true });
          if (savingsDelta !== 0) {
            transaction.set(savingsRef, {
              totalSetAside: savingsTotalSetAside,
              currency: savingsSnapshot.data()?.currency || fields.currency || "GBP",
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        });

        return NextResponse.json({
          ok: true,
          action,
          costId: costRef.id,
          savingsTotalSetAside,
        });
      }

      case "delete_large_cost": {
        const costId = String(body?.costId || "").trim();
        if (!costId) {
          return NextResponse.json({ ok: false, error: "Missing large cost id." }, { status: 400 });
        }

        const costRef = userRef.doc(costId);
        let savingsTotalSetAside = 0;
        await db.runTransaction(async (transaction) => {
          const [snapshot, savingsSnapshot] = await Promise.all([
            transaction.get(costRef),
            transaction.get(savingsRef),
          ]);
          const restoredSavings = getSavingsContribution(snapshot.exists ? snapshot.data() : {});
          savingsTotalSetAside = money(Math.max(0, money(savingsSnapshot.data()?.totalSetAside)) + restoredSavings);
          transaction.delete(costRef);
          if (restoredSavings > 0) {
            transaction.set(savingsRef, {
              totalSetAside: savingsTotalSetAside,
              currency: savingsSnapshot.data()?.currency || snapshot.data()?.currency || "GBP",
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        });
        return NextResponse.json({ ok: true, action, costId, savingsTotalSetAside });
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

    if (error?.code === "large-cost/insufficient-savings") {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    console.error("[dashboard-large-costs] error", error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not save that large cost." },
      { status: 500 },
    );
  }
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function getSavingsContribution(fields) {
  if (Number.isFinite(Number(fields?.savingsContribution))) {
    return Math.max(0, money(fields.savingsContribution));
  }
  return Math.max(0, money(fields?.amountAlreadySaved));
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
