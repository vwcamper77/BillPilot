import { NextResponse } from "next/server";
import { isAnalyticsAdminEmail, verifyIdTokenFromRequest } from "@/lib/adminAuth.server";

export const runtime = "nodejs";

// Lightweight check used to gate nav links (account page, dashboard) —
// separate from the heavy GET /api/admin/analytics aggregation route.
export async function GET(request) {
  try {
    const decodedToken = await verifyIdTokenFromRequest(request);
    return NextResponse.json({ ok: true, isAdmin: isAnalyticsAdminEmail(decodedToken.email) });
  } catch {
    return NextResponse.json({ ok: true, isAdmin: false });
  }
}
