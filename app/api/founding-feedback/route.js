import { NextResponse } from "next/server";
import {
  describeFirestoreAdminError,
  FieldValue,
  getAdminAuth,
  getAdminDb,
  getFirebaseProjectId,
} from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message || body?.answer || "").trim();
    const page = String(body?.page || "stripe-success").trim() || "stripe-success";
    const identity = await getOptionalIdentity(request);

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Feedback answer is required." },
        { status: 400 },
      );
    }

    await getAdminDb().collection("foundingFeedback").add({
      uid: identity?.uid || null,
      email: identity?.email || null,
      message,
      page,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    // Never surface the raw SDK/gRPC error (e.g. Firestore "5 NOT_FOUND:") to the user.
    console.error("[founding-feedback] error", {
      firebaseProjectId: getFirebaseProjectId(),
      friendlyMessage: describeFirestoreAdminError(error),
    }, error);

    return NextResponse.json(
      { ok: false, error: "Sorry, we could not save that feedback. Please try again." },
      { status: 500 },
    );
  }
}

async function getOptionalIdentity(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(match[1]);
    return {
      uid: decodedToken.uid || null,
      email: String(decodedToken.email || "").trim().toLowerCase() || null,
    };
  } catch {
    return null;
  }
}
