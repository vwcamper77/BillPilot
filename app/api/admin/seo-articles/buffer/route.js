import { NextResponse } from "next/server";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import {
  approveSocialPack,
  cancelBufferSocialItem,
  discoverBufferConfiguration,
  generateSocialPack,
  rescheduleBufferSocialItem,
  sendSocialItemToBuffer,
  syncBufferPostStatuses,
} from "@/lib/seoArticles/bufferOperations.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  try {
    const actor = await verifyAnalyticsAdminRequest(request);
    const body = await request.json().catch(() => ({}));
    let result;
    if (body.action === "discover") result = await discoverBufferConfiguration(actor);
    else if (body.action === "generate_pack") result = await generateSocialPack({ ...body, actor });
    else if (body.action === "approve_pack") result = await approveSocialPack({ ...body, actor });
    else if (["create_idea", "schedule"].includes(body.action)) {
      result = await sendSocialItemToBuffer({ ...body, actor });
    } else if (body.action === "cancel") {
      result = await cancelBufferSocialItem({ ...body, actor });
    } else if (body.action === "reschedule") {
      result = await rescheduleBufferSocialItem({ ...body, actor });
    } else if (body.action === "sync") result = await syncBufferPostStatuses(actor);
    else throw new TypeError("Choose a valid Buffer action.");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const auth = String(error?.code || "").startsWith("auth/");
    return NextResponse.json({
      ok: false,
      code: error?.code || "buffer/operation-failed",
      error: auth
        ? "You are not authorised to manage Buffer distribution."
        : error?.code === "buffer/sync-disabled"
          ? "Buffer sync is disabled. Enable it explicitly in both environment and SEO settings."
          : error?.code === "buffer/queue-capacity"
            ? "The Buffer queue does not have enough capacity for this post."
            : "Buffer could not complete the operation. The article was not changed.",
    }, { status: auth ? (error.code === "auth/forbidden" ? 403 : 401) : 409 });
  }
}
