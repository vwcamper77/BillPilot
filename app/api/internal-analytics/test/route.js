import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import { isInternalAnalyticsRequest, isInternalAnalyticsUid } from "@/lib/analytics/internal.server";
import { sendGa4Event } from "@/lib/analytics/ga4.server";
import { sendMetaCapiEvent } from "@/lib/analytics/meta.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await verifyRequestUser(request);
    if (!isInternalAnalyticsUid(user.uid) || !isInternalAnalyticsRequest(request)) {
      return NextResponse.json({ ok: false, error: "Enable authorised internal testing first." }, { status: 403 });
    }
    const eventId = `internal_debug_${Date.now()}`;
    const diagnostics = [
      sendGa4Event({ eventName: "internal_debug_test", userId: user.uid, forceDebug: true, params: { traffic_type: "internal", test_event: true } }),
      ...(process.env.META_TEST_EVENT_CODE ? [sendMetaCapiEvent({ eventName: "InternalDebug", eventId, uid: user.uid, testEventCode: process.env.META_TEST_EVENT_CODE })] : []),
    ];
    const results = await Promise.allSettled(diagnostics);
    return NextResponse.json({ ok: true, productionConversion: false, ga4: results[0]?.status, meta: process.env.META_TEST_EVENT_CODE ? results[1]?.status : "skipped_no_test_code" });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not send diagnostic events." }, { status: 500 });
  }
}
