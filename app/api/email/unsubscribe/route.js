import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { signEmailActionToken } from "@/lib/email";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { normaliseLeadEmail } from "@/lib/leadMagnet";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") || "";
  const type = url.searchParams.get("type") || "";
  const token = url.searchParams.get("token") || "";

  if (!userId || !type || token !== signEmailActionToken({ userId, type })) {
    return NextResponse.json({ ok: false, error: "Invalid unsubscribe link." }, { status: 400 });
  }

  const db = getAdminDb();
  if (type === "lead_marketing") {
    await Promise.all([
      db.collection("emailSuppressions").doc(userId).set({
        reason: "unsubscribe",
        source: "lead_marketing",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      db.collection("marketingSubscribers").doc(userId).set({
        status: "unsubscribed",
        unsubscribedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
  } else {
    const userSnapshot = await db.collection("users").doc(userId).get();
    const userEmail = normaliseLeadEmail(userSnapshot.data()?.email);
    const emailHash = userEmail
      ? createHash("sha256").update(userEmail).digest("hex")
      : null;
    await Promise.all([
      db.collection("users").doc(userId).collection("settings").doc("emailPreferences").set({
        weeklyReminders: false,
        optionalReminders: false,
        unsubscribedAt: new Date().toISOString(),
      }, { merge: true }),
      db.collection("emailSuppressions").doc(userId).set({
        reason: "unsubscribe",
        source: "account",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      ...(emailHash ? [db.collection("emailSuppressions").doc(emailHash).set({
        reason: "unsubscribe",
        source: "account_email",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })] : []),
    ]);
  }

  return NextResponse.redirect(new URL("/unsubscribe?success=1", request.url));
}
