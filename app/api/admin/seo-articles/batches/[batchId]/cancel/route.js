import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import {
  cancelSeoGenerationBatch,
} from "@/lib/seoArticles/batchCancellation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authStatus(error) {
  if (error?.code === "auth/forbidden") return 403;
  if (String(error?.code || "").startsWith("auth/")) return 401;
  return null;
}

function errorStatus(error) {
  if (error?.code === "seo/batch-not-found") return 404;
  if (["seo/batch-id-invalid", "seo/batch-id-ambiguous"].includes(error?.code)) return 400;
  return 409;
}

export async function POST(request, { params }) {
  try {
    const actor = await verifyAnalyticsAdminRequest(request);
    const { batchId } = await params;
    const result = await cancelSeoGenerationBatch({ batchId, actor });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const auth = authStatus(error);
    if (auth) {
      return NextResponse.json({
        ok: false,
        error: auth === 403
          ? "You are not allowed to cancel SEO generation batches."
          : "Please sign in to ClearTill again.",
      }, { status: auth });
    }
    console.error("[seo-batch-cancel] cancellation failed", {
      code: error?.code || "unknown",
    });
    return NextResponse.json({
      ok: false,
      code: error?.code || "seo/batch-cancellation-failed",
      error: error?.message || "The generation batch could not be cancelled.",
    }, { status: errorStatus(error) });
  }
}
