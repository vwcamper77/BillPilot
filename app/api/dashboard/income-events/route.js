import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const FREQUENCIES = new Set(["one_off", "weekly", "fortnightly", "monthly"]);
const CONFIDENCE_LEVELS = new Set(["confirmed", "estimated"]);

export async function POST(request) {
  try {
    const decodedToken = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const collectionRef = getAdminDb().collection("users").doc(decodedToken.uid).collection("incomeEvents");

    if (action === "save_income_event") {
      const fields = normaliseFields(body?.fields || {});
      const eventId = String(body?.eventId || "").trim();
      const eventRef = eventId ? collectionRef.doc(eventId) : collectionRef.doc();
      const snapshot = await eventRef.get();
      await eventRef.set({
        ...fields,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      return NextResponse.json({ ok: true, action, eventId: eventRef.id, event: { id: eventRef.id, ...fields } });
    }

    if (action === "delete_income_event") {
      const eventId = String(body?.eventId || "").trim();
      if (!eventId) return NextResponse.json({ ok: false, error: "Missing income event id." }, { status: 400 });
      await collectionRef.doc(eventId).delete();
      return NextResponse.json({ ok: true, action, eventId });
    }

    return NextResponse.json({ ok: false, error: "Unsupported income event action." }, { status: 400 });
  } catch (error) {
    if (String(error?.code || "").startsWith("auth/")) {
      return NextResponse.json({ ok: false, error: "Please sign in again before saving that income." }, { status: 401 });
    }
    if (error?.code === "income-event/validation") {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("[dashboard-income-events] error", error);
    return NextResponse.json({ ok: false, error: error?.message || "Could not save that income." }, { status: 500 });
  }
}

function validationError(message) {
  const error = new Error(message);
  error.code = "income-event/validation";
  throw error;
}

function normaliseFields(raw) {
  const name = String(raw?.name || "").trim().slice(0, 80);
  const amount = Math.round(Number(raw?.amount) * 100) / 100;
  const expectedDate = String(raw?.expectedDate || "").trim();
  const frequency = String(raw?.frequency || "one_off").trim();
  const confidence = String(raw?.confidence || "confirmed").trim();
  if (!name) validationError("Add a name for this income.");
  if (!Number.isFinite(amount) || amount <= 0) validationError("Enter an income amount greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) validationError("Choose the date this money is expected.");
  if (!FREQUENCIES.has(frequency)) validationError("Choose a valid repeat option.");
  if (!CONFIDENCE_LEVELS.has(confidence)) validationError("Choose whether this income is confirmed or estimated.");
  return {
    name,
    amount,
    expectedDate,
    frequency,
    confidence,
    status: "scheduled",
    active: true,
    currency: "GBP",
  };
}

async function verifyRequest(request) {
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
