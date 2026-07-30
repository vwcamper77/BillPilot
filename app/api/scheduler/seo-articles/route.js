import { NextResponse } from "next/server";
import { runScheduledSeoArticle } from "@/lib/seoArticles/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isSchedulerRequest(request) {
  const secret = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request) {
  if (!isSchedulerRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const now = process.env.NODE_ENV === "test" && body.now ? new Date(body.now) : new Date();
    const result = await runScheduledSeoArticle({ now, topic: body.topic });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("[seo-article-scheduler] failed", { code: error?.code || "unknown" });
    return NextResponse.json({
      ok: false,
      code: "seo/scheduled-run-failed",
      error: "The scheduled article run did not complete.",
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: false,
    error: "SEO article generation requires an authorised POST request.",
  }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request) {
  return handle(request);
}
