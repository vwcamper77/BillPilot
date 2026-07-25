import { NextResponse } from "next/server";

import {
  assertSeoCronAuthorised,
  getSeoEngineConfig,
} from "../../../../lib/seo-engine/config";
import { selectNextSeedTopic } from "../../../../lib/seo-engine/seed-topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = assertSeoCronAuthorised(request);
  if (!auth.authorised) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: 401 },
    );
  }

  const config = getSeoEngineConfig();
  if (!config.enabled) {
    return NextResponse.json({
      ok: true,
      status: "disabled",
      message: "SEO engine is disabled. No draft was generated.",
    });
  }

  const topic = selectNextSeedTopic();
  if (!topic) {
    return NextResponse.json({
      ok: true,
      status: "idle",
      message: "No eligible SEO topic is available.",
    });
  }

  // Foundation release: this endpoint deliberately stops before model calls,
  // persistence or publication. The next implementation stage will persist an
  // idempotent daily job and create an approval-gated draft package.
  return NextResponse.json({
    ok: true,
    status: "ready",
    mode: "draft-only",
    autoPublishEnabled: false,
    dailyDraftLimit: config.dailyDraftLimit,
    topic,
  });
}
