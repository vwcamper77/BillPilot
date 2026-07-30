import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import {
  getSeoOperationsArea,
  mutateSeoOperations,
} from "@/lib/seoArticles/contentOps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AREAS = new Set([
  "overview",
  "calendar",
  "generate",
  "review",
  "publishing",
  "distribution",
  "performance",
  "settings",
]);

function authStatus(error) {
  if (error?.code === "auth/forbidden") return 403;
  if (String(error?.code || "").startsWith("auth/")) return 401;
  return null;
}

function friendlyError(error) {
  if (error?.code === "seo/generation-disabled") {
    return "Content generation is disabled in SEO settings.";
  }
  if (error?.code === "seo/bulk-review-blocked") {
    return "Bulk approval was blocked by an unresolved quality, source, hero or duplicate warning.";
  }
  if (error?.code === "buffer/channel-selection-invalid") {
    return "The Buffer channel selection was not accepted. Personal LinkedIn profiles require explicit approval.";
  }
  if (error?.code === "seo/duplicate-primary-keyword") {
    return "That primary keyword is already assigned to another calendar item.";
  }
  return "The SEO operation could not be completed.";
}

export async function GET(request, { params }) {
  try {
    await verifyAnalyticsAdminRequest(request);
    const { area } = await params;
    if (!AREAS.has(area)) {
      return NextResponse.json({ ok: false, error: "SEO operations area not found." }, { status: 404 });
    }
    const data = await getSeoOperationsArea(area);
    return NextResponse.json({ ok: true, ...data }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = authStatus(error);
    if (status) {
      return NextResponse.json({
        ok: false,
        error: status === 403
          ? "You are not allowed to manage SEO operations."
          : "Please sign in to ClearTill again.",
      }, { status });
    }
    console.error("[seo-operations] read failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      error: "The SEO operations data could not be loaded.",
    }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const actor = await verifyAnalyticsAdminRequest(request);
    const { area } = await params;
    if (!AREAS.has(area)) {
      return NextResponse.json({ ok: false, error: "SEO operations area not found." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const result = await mutateSeoOperations(area, body.action, body, actor);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const auth = authStatus(error);
    if (auth) {
      return NextResponse.json({
        ok: false,
        error: "You are not authorised to change SEO operations.",
      }, { status: auth });
    }
    console.error("[seo-operations] mutation failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      code: error?.code || "seo/operation-failed",
      error: friendlyError(error),
      blocked: Array.isArray(error?.blocked) ? error.blocked : undefined,
    }, { status: 409 });
  }
}
