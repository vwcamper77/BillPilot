import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { getSeoAdminArticle } from "@/lib/seoArticles/admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const { articleId } = await params;
    const article = await getSeoAdminArticle(articleId);
    const response = NextResponse.json({ ok: true, ...article });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    const status = auth
      ? error.code === "auth/forbidden" ? 403 : 401
      : error?.code === "seo/article-not-found" ? 404 : 500;
    return NextResponse.json({
      ok: false,
      error: auth
        ? "You are not allowed to view this article."
        : status === 404
          ? "Article not found."
          : "The article preview could not be loaded.",
    }, { status });
  }
}
