import { NextResponse } from "next/server";
import { sanitiseAnalyticsPayload, trackServerAnalyticsEvent } from "@/lib/analytics";
import { verifyRequestUser } from "@/lib/serverAuth";
import { isInternalAnalyticsRequest } from "@/lib/analytics/internal.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    if (isInternalAnalyticsRequest(request)) {
      return NextResponse.json({ ok: true, suppressed: true });
    }
    const body = await request.json().catch(() => ({}));
    const eventName = String(body?.eventName || "");
    const payload = sanitiseAnalyticsPayload(body?.payload || {});
    const token = request.headers.get("authorization");

    if (token) {
      const decodedToken = await verifyRequestUser(request);
      payload.uid = decodedToken.uid;
    } else if (body?.sessionId) {
      payload.sessionId = String(body.sessionId).slice(0, 80);
    }

    const result = await trackServerAnalyticsEvent(eventName, payload);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not record that event." },
      { status },
    );
  }
}
