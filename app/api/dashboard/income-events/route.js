import { NextResponse } from "next/server";
import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { assertCanEditFinancialData, isReadOnlyAccessError } from "@/lib/financialAccess.server";

export const runtime = "nodejs";

const FREQUENCIES = new Set(["one_off", "weekly", "fortnightly", "four_weekly", "monthly"]);
const CONFIDENCE_LEVELS = new Set(["confirmed", "estimated"]);
const OCCURRENCE_STATUSES = new Set(["received", "skipped"]);

export async function POST(request) {
  try {
    const decodedToken = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    await assertCanEditFinancialData(decodedToken.uid, { accountEmail: decodedToken.email || null });
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

    if (action === "set_income_active") {
      const eventId = String(body?.eventId || "").trim();
      if (!eventId) return NextResponse.json({ ok: false, error: "Missing income source id." }, { status: 400 });
      const active = body?.active === true;
      await collectionRef.doc(eventId).set({ active, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true, action, eventId, active });
    }

    if (action === "set_income_occurrence_status") {
      const eventId = String(body?.eventId || "").trim();
      const occurrenceDate = String(body?.occurrenceDate || "").trim();
      const status = String(body?.status || "").trim();
      if (!eventId || !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || !OCCURRENCE_STATUSES.has(status)) {
        return NextResponse.json({ ok: false, error: "Choose a valid income occurrence and status." }, { status: 400 });
      }
      // Update the individual map entry. A top-level merge of
      // `occurrenceStatuses` replaces the whole map and would silently lose
      // confirmations/skips recorded for earlier occurrences.
      await collectionRef.doc(eventId).update({
        [`occurrenceStatuses.${occurrenceDate}`]: status,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true, action, eventId, occurrenceDate, status });
    }

    return NextResponse.json({ ok: false, error: "Unsupported income event action." }, { status: 400 });
  } catch (error) {
    if (isReadOnlyAccessError(error)) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
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
  const firstPaymentDate = String(raw?.firstPaymentDate || raw?.expectedDate || "").trim();
  const frequency = String(raw?.frequency || "one_off").trim();
  const confidence = String(raw?.confidence || "confirmed").trim();
  const endDate = String(raw?.endDate || "").trim();
  if (!name) validationError("Add a name for this income.");
  if (!Number.isFinite(amount) || amount <= 0) validationError("Enter an income amount greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstPaymentDate)) validationError("Choose the first payment date.");
  if (!FREQUENCIES.has(frequency)) validationError("Choose a valid repeat option.");
  if (!CONFIDENCE_LEVELS.has(confidence)) validationError("Choose whether this income is confirmed or estimated.");
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < firstPaymentDate)) validationError("Choose an end date after the first payment.");
  return {
    name,
    amount,
    firstPaymentDate,
    expectedDate: firstPaymentDate,
    frequency,
    endDate: endDate || null,
    confidence,
    active: raw?.active !== false,
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
