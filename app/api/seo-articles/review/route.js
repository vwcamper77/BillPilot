import { NextResponse } from "next/server";
import { performSeoReviewAction } from "@/lib/seoArticles/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
    const result = await performSeoReviewAction({
      token: body.token,
      note: body.note,
    });
    if (contentType.includes("application/json")) return NextResponse.json(result);
    return NextResponse.redirect(
      new URL(`/seo/review/result?action=${encodeURIComponent(result.action)}&status=${encodeURIComponent(result.status)}`, request.url),
      303,
    );
  } catch (error) {
    return NextResponse.json({
      ok: false,
      published: false,
      code: "seo/review-action-failed",
      error: /invalid|expired|replaced|actioned/i.test(String(error?.message || ""))
        ? "This review action is invalid, expired, or already completed."
        : "The review action could not be completed.",
    }, { status: 400 });
  }
}
