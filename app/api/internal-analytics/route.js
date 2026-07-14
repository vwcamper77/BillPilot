import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import {
  createInternalAnalyticsCookie,
  internalCookieOptions,
  INTERNAL_ANALYTICS_COOKIE,
  isInternalAnalyticsRequest,
  isInternalAnalyticsUid,
} from "@/lib/analytics/internal.server";

export const runtime = "nodejs";

export async function GET(request) {
  let eligible = false;
  try {
    const user = await verifyRequestUser(request);
    eligible = isInternalAnalyticsUid(user.uid);
  } catch {}
  return NextResponse.json({ ok: true, active: isInternalAnalyticsRequest(request), eligible });
}

export async function POST(request) {
  try {
    const user = await verifyRequestUser(request);
    if (!isInternalAnalyticsUid(user.uid)) {
      return NextResponse.json({ ok: false, error: "This account is not authorised for internal analytics testing." }, { status: 403 });
    }
    const response = NextResponse.json({ ok: true, active: true });
    response.cookies.set(INTERNAL_ANALYTICS_COOKIE, createInternalAnalyticsCookie(), internalCookieOptions);
    return response;
  } catch (error) {
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json({ ok: false, error: status === 401 ? "Sign in again." : "Could not enable internal testing." }, { status });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true, active: false });
  response.cookies.set(INTERNAL_ANALYTICS_COOKIE, "", { ...internalCookieOptions, maxAge: 0 });
  return response;
}
