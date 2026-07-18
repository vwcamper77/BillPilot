import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";
import { startPreviewForUid } from "@/lib/previewLifecycle.server";
import { trackServerAnalyticsEvent } from "@/lib/analytics";
import { runReminderForUser } from "@/lib/reminders/service.server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const user = await verifyRequestUser(request);
    if (!user?.uid || user.firebase?.sign_in_provider === "anonymous") {
      return NextResponse.json({ ok: false, error: "Create or sign in to a ClearTill account first." }, { status: 401 });
    }

    const existingAccess = await resolveEntitlementForUid(user.uid, { accountEmail: user.email || null });
    if (existingAccess.hasAccess && existingAccess.accessType !== "no_card_preview") {
      return NextResponse.json({ ok: true, alreadyEntitled: true, access: existingAccess });
    }
    if (!existingAccess.hasAccess && !existingAccess.canStartPreview && !existingAccess.previewUsed) {
      return NextResponse.json({ ok: false, error: "This account has already used an introductory access period." }, { status: 409 });
    }

    await trackServerAnalyticsEvent("preview_start_requested", { uid: user.uid, source: "first_complete_position" });
    const result = await startPreviewForUid(user.uid);
    const access = await resolveEntitlementForUid(user.uid, { accountEmail: user.email || null });

    if (result.created) {
      await runReminderForUser(user.uid, { onlyLifecycle: true }).catch((error) => {
        console.error("[preview-start] reminder lifecycle failed", { code: error?.code || "unknown" });
      });
      await trackServerAnalyticsEvent("preview_started", { uid: user.uid, source: "first_complete_position" });
    }

    return NextResponse.json({ ok: true, created: result.created, preview: result.preview, access });
  } catch (error) {
    if (error?.code === "preview/incomplete-position") {
      return NextResponse.json({ ok: false, error: error.message, completeness: error.completeness }, { status: 409 });
    }
    const status = error?.code?.startsWith?.("auth/") ? 401 : 500;
    return NextResponse.json({ ok: false, error: status === 500 ? "Could not start your preview right now." : error.message }, { status });
  }
}
