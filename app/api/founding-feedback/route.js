import { NextResponse } from "next/server";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const answer = String(body?.answer || "").trim();

    if (!answer) {
      return NextResponse.json(
        { ok: false, error: "Feedback answer is required." },
        { status: 400 },
      );
    }

    await getAdminDb().collection("foundingFeedback").add({
      answer,
      createdAt: FieldValue.serverTimestamp(),
      source: "billing_success_page",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    // Never surface the raw SDK/gRPC error (e.g. Firestore "5 NOT_FOUND:") to the user.
    console.error("[founding-feedback] error", error);

    return NextResponse.json(
      { ok: false, error: "Sorry, we could not save that feedback. Please try again." },
      { status: 500 },
    );
  }
}
