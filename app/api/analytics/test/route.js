import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { sendGa4Event } from "@/lib/analytics/ga4.server";

export const runtime = "nodejs";

// Temporary diagnostic endpoint. It is POST-only and restricted to the
// existing ADMIN_EMAILS allowlist through a verified Firebase ID token.
export async function POST(request) {
  try {
    const identity = await verifyAnalyticsAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const requestedClientId = String(body?.clientId || "").trim();
    const clientId = /^\d+\.\d+$/.test(requestedClientId) ? requestedClientId : null;
    const result = await sendGa4Event({
      eventName: "qa_analytics_test",
      clientId,
      userId: identity.uid,
      params: { test_flow: true },
    });

    return NextResponse.json({
      ok: result.sent,
      eventName: "qa_analytics_test",
      debug: result.debug ?? null,
      collectStatus: result.collectStatus ?? null,
      validationStatus: result.validationStatus ?? null,
      validationMessages: result.validation?.validationMessages || [],
      reason: result.reason || null,
      missing: result.missing || [],
    }, { status: result.sent ? 200 : 503 });
  } catch (error) {
    if (error?.code === "auth/forbidden") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (String(error?.code || "").startsWith("auth/")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    console.error("[ga4-test] delivery failed", { message: error?.message || "Unknown analytics delivery error" });
    return NextResponse.json({ ok: false, error: "Analytics delivery failed." }, { status: 502 });
  }
}
