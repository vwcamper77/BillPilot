import { NextResponse } from "next/server";
import { reprocessSeoArticleHero } from "@/lib/seoArticles/engine.server";
import runtimeConfig from "@/lib/seoArticles/runtimeConfig.cjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorised(request, schedulerSecret) {
  const supplied = request.headers.get("authorization") || "";
  const manualSecret = String(process.env.SEO_DRY_RUN_SECRET || "").trim();
  return (Boolean(manualSecret) && supplied === `Bearer ${manualSecret}`)
    || (Boolean(schedulerSecret) && supplied === `Bearer ${schedulerSecret}`);
}

export async function POST(request) {
  const config = runtimeConfig.getSeoArticleRuntimeConfig();
  if (!isAuthorised(request, config.values.schedulerSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!config.ok) {
    return NextResponse.json({
      ok: false,
      code: config.code,
      error: "The SEO article engine is not fully configured.",
      missing: config.missing,
      noWorkStarted: true,
    }, { status: 503 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    if (
      body.confirmNoPublish !== true
      || String(body.confirmProjectId || "") !== config.values.firebaseProjectId
      || !String(body.draftId || "").trim()
    ) {
      return NextResponse.json({
        ok: false,
        code: "seo/confirmation-required",
        error: "Confirm the exact Firebase project, draft, and no-publication boundary.",
        noWorkStarted: true,
      }, { status: 409 });
    }
    const result = await reprocessSeoArticleHero({ draftId: body.draftId });
    return NextResponse.json({
      ...result,
      publicationActivated: false,
    });
  } catch (error) {
    console.error("[seo-hero-rereview] failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      code: error?.code || "seo/hero-rereview-failed",
      error: "The controlled hero reprocessing run did not complete.",
      publicationActivated: false,
    }, { status: 500 });
  }
}
