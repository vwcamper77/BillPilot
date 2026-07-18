import { NextResponse } from "next/server";
import { getRequestIp, RateLimitedError } from "@/lib/security/rateLimit.server";
import {
  LeadMagnetValidationError,
  processLeadMagnetSubmission,
} from "@/lib/leadMagnet.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await processLeadMagnetSubmission({ body, ip: getRequestIp(request) });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LeadMagnetValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof RateLimitedError) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please wait and try again." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    console.error("[lead-magnet] fulfilment failed", { code: error?.code || "lead_fulfilment_failed" });
    return NextResponse.json(
      { ok: false, error: "We could not send the guide right now. Please try again." },
      { status: 500 },
    );
  }
}
