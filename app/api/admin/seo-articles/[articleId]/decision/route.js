import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { performAdminSeoReviewAction } from "@/lib/seoArticles/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const { articleId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await performAdminSeoReviewAction({
      draftId: articleId,
      versionId: body.versionId,
      action: body.action,
      note: body.note,
    });
    return NextResponse.json(result);
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    const status = auth ? (error.code === "auth/forbidden" ? 403 : 401) : 409;
    return NextResponse.json({
      ok: false,
      published: false,
      code: error?.code || "seo/admin-review-failed",
      error: auth
        ? "You are not authorised to review SEO articles."
        : error?.code === "seo/stale-version"
          ? "This article version is stale. Refresh before reviewing."
          : "This review has already been completed or is no longer eligible.",
    }, { status });
  }
}
