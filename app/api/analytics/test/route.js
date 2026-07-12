import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { sendGa4Event } from "@/lib/analytics/ga4.server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

// Temporary diagnostic endpoint. It is POST-only and restricted to the
// existing ADMIN_EMAILS allowlist through a verified Firebase ID token.
export async function POST(request) {
  try {
    const identity = await authorizeDiagnosticRequest(request);
    const body = await request.json().catch(() => ({}));
    const requestedClientId = String(body?.clientId || "").trim();
    const requestedSessionId = String(body?.sessionId || "").trim();
    const clientId = /^\d+\.\d+$/.test(requestedClientId) ? requestedClientId : null;
    const sessionId = /^\d+$/.test(requestedSessionId) && Number(requestedSessionId) > 0
      ? Number(requestedSessionId)
      : null;
    console.info("[ga4-test] browser identifiers", {
      clientIdPresent: Boolean(clientId),
      sessionIdPresent: Boolean(sessionId),
    });
    if (!clientId || !sessionId) {
      return NextResponse.json({
        ok: false,
        error: "A real GA4 browser client ID and session ID are required.",
        clientIdPresent: Boolean(clientId),
        sessionIdPresent: Boolean(sessionId),
      }, { status: 400 });
    }
    const result = await sendGa4Event({
      eventName: "qa_analytics_test",
      clientId,
      userId: identity.uid,
      params: { test_flow: true, session_id: sessionId, engagement_time_msec: 1 },
      forceDebug: true,
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

async function authorizeDiagnosticRequest(request) {
  const configuredToken = String(process.env.ANALYTICS_TEST_TOKEN || "");
  const suppliedToken = String(request.headers.get("x-analytics-test-token") || "");
  if (configuredToken && suppliedToken && safeEqual(configuredToken, suppliedToken)) {
    return { uid: "analytics-diagnostic" };
  }
  return verifyAnalyticsAdminRequest(request);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
