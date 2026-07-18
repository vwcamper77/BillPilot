import { FieldValue, getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getAppBaseUrl } from "@/lib/billing/config";
import { claimEmailDelivery, markEmailDelivery, sendResendEmail } from "@/lib/email";

export async function sendPaymentFailureNotice({ uid, invoiceId }) {
  const [authUser, suppression] = await Promise.all([
    getAdminAuth().getUser(uid).catch(() => null),
    getAdminDb().collection("emailSuppressions").doc(uid).get(),
  ]);
  if (!authUser?.email || !authUser.emailVerified || suppression.exists) {
    return { status: "suppressed" };
  }

  const delivery = await claimEmailDelivery({
    userId: uid,
    type: "billing_payment_failed",
    period: String(invoiceId || "unknown_invoice"),
    transactional: true,
  });
  if (!delivery.ok) return { status: delivery.reason };

  const billingUrl = `${getAppBaseUrl()}/billing`;
  const subject = "Action needed for your ClearTill payment";
  const text = `We could not confirm your latest ClearTill payment. Review your billing details securely in ClearTill.\n\nReview billing: ${billingUrl}`;
  const html = `<p>We could not confirm your latest ClearTill payment.</p><p>Review your billing details securely in ClearTill.</p><p><a href="${billingUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#143c3a;color:#ffffff;font-weight:700;text-decoration:none">Review billing</a></p>`;

  try {
    const response = await sendResendEmail({
      to: authUser.email,
      subject,
      text,
      html,
      headers: {
        "X-ClearTill-Email-Type": "billing_payment_failed",
        "X-ClearTill-Idempotency-Key": delivery.idempotencyKey,
      },
    });
    if (response.skipped) throw new Error(response.error || "email_not_configured");
    await markEmailDelivery(delivery.ref, {
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      providerMessageId: response.providerMessageId || null,
      templateId: "billing_payment_failed",
      templateVersion: "2026-07-18.v1",
    }, { claimToken: delivery.claimToken });
    return { status: "sent" };
  } catch (error) {
    await markEmailDelivery(delivery.ref, {
      status: error.permanent ? "permanent_failure" : "failed",
      reason: String(error.message || "send_failed").slice(0, 120),
    }, { claimToken: delivery.claimToken });
    return { status: "failed" };
  }
}
