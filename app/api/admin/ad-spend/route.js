import { NextResponse } from "next/server";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";

export const runtime = "nodejs";

const PLATFORMS = new Set(["meta", "google", "tiktok", "other"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request) {
  try {
    const decodedToken = await verifyAnalyticsAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    switch (action) {
      case "create": {
        const date = String(body?.date || "").trim();
        const platform = String(body?.platform || "").trim().toLowerCase();
        const campaign = String(body?.campaign || "").trim();
        const spend = Number(body?.spend);
        const notes = body?.notes ? String(body.notes).trim().slice(0, 500) : null;

        if (!DATE_PATTERN.test(date)) {
          return NextResponse.json({ ok: false, error: "Enter a valid date." }, { status: 400 });
        }
        if (!PLATFORMS.has(platform)) {
          return NextResponse.json({ ok: false, error: "Choose a valid platform." }, { status: 400 });
        }
        if (!campaign) {
          return NextResponse.json({ ok: false, error: "Enter a campaign name." }, { status: 400 });
        }
        if (!Number.isFinite(spend) || spend < 0) {
          return NextResponse.json({ ok: false, error: "Enter a valid spend amount." }, { status: 400 });
        }

        const ref = getAdminDb().collection("adSpend").doc();
        await ref.set({
          date,
          platform,
          campaign,
          spend,
          currency: "gbp",
          notes,
          createdAt: FieldValue.serverTimestamp(),
          createdByEmail: decodedToken.email || null,
        });

        return NextResponse.json({ ok: true, action, id: ref.id });
      }

      case "delete": {
        const id = String(body?.id || "").trim();
        if (!id) {
          return NextResponse.json({ ok: false, error: "Missing ad spend id." }, { status: 400 });
        }

        await getAdminDb().collection("adSpend").doc(id).delete();
        return NextResponse.json({ ok: true, action, id });
      }

      default:
        return NextResponse.json({ ok: false, error: "Unsupported ad spend action." }, { status: 400 });
    }
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    }

    if (error?.code === "auth/forbidden") {
      return NextResponse.json({ ok: false, error: "You are not allowed to manage ad spend." }, { status: 403 });
    }

    console.error("[admin-ad-spend] error", error);

    return NextResponse.json({ ok: false, error: error?.message || "Could not save that ad spend entry." }, { status: 500 });
  }
}
