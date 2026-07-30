import { NextResponse } from "next/server";
import { runScheduledSeoArticle } from "@/lib/seoArticles/engine.server";
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
    ) {
      return NextResponse.json({
        ok: false,
        code: "seo/confirmation-required",
        error: "Confirm the exact Firebase project and no-publication boundary.",
        noWorkStarted: true,
      }, { status: 409 });
    }
    const result = await runScheduledSeoArticle({
      now: body.now && process.env.NODE_ENV !== "production"
        ? new Date(body.now)
        : new Date(),
      topic: body.topic,
    });
    return NextResponse.json({
      ...result,
      dryRun: true,
      publicationActivated: false,
    }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("[seo-article-dry-run] failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      code: error?.code || "seo/dry-run-failed",
      error: error?.code === "seo/misconfigured"
        ? "The SEO article engine is not fully configured."
        : "The controlled SEO article run did not complete.",
      missing: error?.missing || undefined,
      publicationActivated: false,
    }, { status: error?.code === "seo/misconfigured" ? 503 : 500 });
  }
}
