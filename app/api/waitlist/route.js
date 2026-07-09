import { NextResponse } from "next/server";
import { FieldValue, getAdminDb, getFirebaseProjectId } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    await getAdminDb().collection("waitlist").doc(email).set(
      {
        email,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[waitlist] failed to save signup", {
      firebaseProjectId: getFirebaseProjectId(),
    }, error);

    return NextResponse.json(
      { ok: false, error: "Could not join the waitlist right now. Please try again." },
      { status: 500 },
    );
  }
}
