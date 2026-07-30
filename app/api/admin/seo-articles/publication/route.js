import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { performSeoPublicationAction } from "@/lib/seoArticles/publishing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  try {
    const actor = await verifyAnalyticsAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    const result = await performSeoPublicationAction({ ...body, actor });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    const stale = error?.code === "seo/stale-version";
    const collision = error?.code === "seo/slug-collision";
    return NextResponse.json({
      ok: false,
      published: false,
      code: error?.code || "seo/publication-failed",
      error: auth
        ? "You are not authorised to publish Journal articles."
        : stale
          ? "This publication request targets a stale article version."
          : collision
            ? "That Journal slug is already used by another article."
            : "The publication action did not pass the required validation.",
    }, { status: auth ? (error.code === "auth/forbidden" ? 403 : 401) : 409 });
  }
}
