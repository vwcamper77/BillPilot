import { NextResponse } from "next/server";
import { signEmailActionToken } from "@/lib/email";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid") || "";
  const type = url.searchParams.get("type") || "";
  const token = url.searchParams.get("token") || "";

  if (!userId || !type || token !== signEmailActionToken({ userId, type })) {
    return NextResponse.json({ ok: false, error: "Invalid unsubscribe link." }, { status: 400 });
  }

  await getAdminDb().collection("users").doc(userId).collection("settings").doc("emailPreferences").set({
    weeklyReminders: false,
    unsubscribedAt: new Date().toISOString(),
  }, { merge: true });

  return NextResponse.redirect(new URL("/unsubscribe?success=1", request.url));
}
