import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { sendFinishedArticleReviewPackage } from "@/lib/seoArticles/reviewPackage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const { articleId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await sendFinishedArticleReviewPackage({
      articleId,
      resend: body.resend === true,
      revision: body.revision,
    });
    return NextResponse.json(result);
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    const status = auth ? (error.code === "auth/forbidden" ? 403 : 401) : 400;
    return NextResponse.json({
      ok: false,
      published: false,
      code: error?.code || "seo/review-package-failed",
      error: auth
        ? "You are not authorised to send SEO review packages."
        : "The finished review package could not be sent.",
    }, { status });
  }
}
