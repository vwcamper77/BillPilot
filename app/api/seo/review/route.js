import { NextResponse } from "next/server";

import { getAdminDb, FieldValue } from "../../../../lib/firebaseAdmin";
import { verifySeoReviewToken } from "../../../../lib/seo-engine/review-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_BY_ACTION = {
  approve: "approved",
  changes: "changes_requested",
  reject: "rejected",
};

function resultPage({ title, message, status = 200 }) {
  const html = `<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:80px auto;padding:24px"><p style="color:#5d6d7e">ClearTill Journal review</p><h1>${title}</h1><p>${message}</p></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(request) {
  const form = await request.formData();
  const draftId = String(form.get("draftId") || "").trim();
  const action = String(form.get("action") || "").trim();
  const token = String(form.get("token") || "").trim();
  const feedback = String(form.get("feedback") || "").trim().slice(0, 2000);
  const targetStatus = STATUS_BY_ACTION[action];

  if (!draftId || !targetStatus) {
    return resultPage({ title: "Invalid review request", message: "The draft or action was not supplied.", status: 400 });
  }

  const verification = verifySeoReviewToken(token, { expectedAction: action });
  if (!verification.valid || verification.claims.draftId !== draftId) {
    return resultPage({ title: "Review link unavailable", message: "This link is invalid, expired or does not match the article.", status: 403 });
  }
  if (action === "changes" && !feedback) {
    return resultPage({ title: "Changes required", message: "Please return to the email and describe the changes needed.", status: 400 });
  }

  const db = getAdminDb();
  const draftRef = db.collection("seoDrafts").doc(draftId);

  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(draftRef);
      if (!snapshot.exists) throw new Error("DRAFT_NOT_FOUND");
      const draft = snapshot.data() || {};

      if (draft.status === targetStatus) return;
      if (!["review_required", "changes_requested"].includes(draft.status)) {
        throw new Error(`INVALID_STATUS:${draft.status || "unknown"}`);
      }

      transaction.update(draftRef, {
        status: targetStatus,
        reviewFeedback: feedback || null,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewSource: "signed_email_confirmation",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    if (error.message === "DRAFT_NOT_FOUND") {
      return resultPage({ title: "Article not found", message: "This draft no longer exists.", status: 404 });
    }
    if (String(error.message || "").startsWith("INVALID_STATUS:")) {
      return resultPage({ title: "Article already processed", message: "This draft is no longer awaiting this review decision.", status: 409 });
    }
    console.error("[seo-review] Failed to record decision", { draftId, action, error });
    return resultPage({ title: "Review could not be saved", message: "No change was made. Please use the admin review queue or try again.", status: 500 });
  }

  const copy = action === "approve"
    ? ["Article approved", "The draft is approved but has not been published automatically."]
    : action === "changes"
      ? ["Changes requested", "The draft has been returned to the drafting queue with your feedback."]
      : ["Article rejected", "The draft has been rejected and retained in the audit trail."];

  return resultPage({ title: copy[0], message: copy[1] });
}
