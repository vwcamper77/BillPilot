import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import {
  processNextSeoGenerationJob,
  retrySeoGenerationJob,
} from "@/lib/seoArticles/batchGeneration.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  try {
    const actor = await verifyAnalyticsAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const result = body.action === "retry"
      ? await retrySeoGenerationJob(body.jobId, actor)
      : await processNextSeoGenerationJob();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    return NextResponse.json({
      ok: false,
      code: error?.code || "seo/generation-job-failed",
      error: auth
        ? "You are not authorised to process SEO generation jobs."
        : error?.code === "seo/generation-disabled"
          ? "Content generation is disabled in SEO settings."
          : "The generation job could not be processed.",
    }, { status: auth ? (error.code === "auth/forbidden" ? 403 : 401) : 409 });
  }
}
