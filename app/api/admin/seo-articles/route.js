import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { getSeoAdminDashboard } from "@/lib/seoArticles/admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authStatus(error) {
  if (error?.code === "auth/forbidden") return 403;
  if (String(error?.code || "").startsWith("auth/")) return 401;
  return null;
}

export async function GET(request) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const data = await getSeoAdminDashboard();
    const response = NextResponse.json({ ok: true, ...data });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const status = authStatus(error);
    if (status) {
      return NextResponse.json({
        ok: false,
        error: status === 403
          ? "You are not allowed to manage SEO articles."
          : "Please sign in to ClearTill again.",
      }, { status });
    }
    console.error("[seo-admin-dashboard] failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      error: "The SEO admin dashboard could not be loaded.",
    }, { status: 500 });
  }
}
