import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { runSeoArticleCanvaAction } from "@/lib/seoArticles/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const user = await verifyAnalyticsAdminRequest(request);
    const body = await request.json();
    if (!body.draftId || !body.action) {
      return NextResponse.json({
        ok: false,
        optional: true,
        published: false,
        error: "Choose an approved export and Canva action.",
      }, { status: 400 });
    }
    const result = await runSeoArticleCanvaAction(
      user.uid,
      String(body.draftId),
      String(body.action),
      body,
    );
    return NextResponse.json({
      ok: true,
      optional: true,
      published: false,
      result,
    });
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    return NextResponse.json({
      ok: false,
      optional: true,
      published: false,
      code: auth ? error.code : error?.code || "canva/unavailable",
      error: auth
        ? "You are not authorised to manage SEO exports."
        : "The publication-ready export is unaffected. Canva could not complete this optional action.",
    }, { status: auth ? (error.code === "auth/forbidden" ? 403 : 401) : 502 });
  }
}
