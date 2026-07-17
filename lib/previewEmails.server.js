import { FieldValue } from "@/lib/firebaseAdmin";
import {
  buildUnsubscribeUrl,
  claimEmailDelivery,
  emailFailureStatus,
  markEmailDelivery,
  sendResendEmail,
  shouldSuppressOptionalEmail,
} from "@/lib/email";
import { getAppBaseUrl } from "@/lib/billing/config";

export const PREVIEW_EMAIL_SUBJECTS = Object.freeze({
  account_created: "Your ClearTill account is ready",
  onboarding_incomplete: "Finish your first ClearTill position",
  preview_started: "Your ClearTill live preview has started",
  preview_balance_check: "Has your balance changed?",
  preview_cost_check: "Is there anything still to add?",
  preview_ending: "Your live ClearTill preview ends tomorrow",
  preview_expired: "Your ClearTill position is now paused",
});

const OPTIONAL_TYPES = new Set(["onboarding_incomplete", "preview_balance_check", "preview_cost_check"]);

export function escapeEmailHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

export function containsFinancialAmount(value) {
  return /(?:£|\$|€)\s*\d|\b\d+(?:\.\d{1,2})?\s*(?:pounds?|gbp)\b/i.test(String(value || ""));
}

export function buildPreviewEmail({ type, endDate = null, onboardingStep = "balance", userId = "", includeAmounts = false } = {}) {
  const baseUrl = getAppBaseUrl();
  const dashboardUrl = `${baseUrl}/dashboard`;
  const onboardingUrl = `${dashboardUrl}?mode=onboarding&step=${encodeURIComponent(onboardingStep)}`;
  const pricingUrl = `${baseUrl}/pricing`;
  const formattedEnd = endDate
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(endDate))
    : "";
  const annual = "£24.99 per year, paid upfront";
  const monthly = "£3.99 per month";
  const optional = OPTIONAL_TYPES.has(type);
  const unsubscribe = optional ? buildUnsubscribeUrl({ userId, type }) : "";
  const content = {
    account_created: ["Your account keeps your ClearTill position connected to you.", "ClearTill does not connect to your bank and no card is required. Your seven-day preview starts only after you save your first complete position.", `Continue setup: ${onboardingUrl}`],
    onboarding_incomplete: ["Your first ClearTill position is not complete yet.", "Finish the next step to see what remains before payday. Your preview will not start until the complete position is saved.", `Continue setup: ${onboardingUrl}`, `Unsubscribe: ${unsubscribe}`],
    preview_started: [`Your live preview runs until ${formattedEnd}.`, "No card was requested and nothing will be charged automatically when it ends.", `Open ClearTill: ${dashboardUrl}`],
    preview_balance_check: ["Your saved balance may have changed. Update it to keep your position useful.", `Update my balance: ${dashboardUrl}?focus=balance&reminder=preview_balance_check`, `Unsubscribe: ${unsubscribe}`],
    preview_cost_check: ["Check for subscriptions, one-off costs or anything else still due before payday.", `Review my costs: ${dashboardUrl}?focus=bills&reminder=preview_cost_check`, `Unsubscribe: ${unsubscribe}`],
    preview_ending: ["Your live preview ends tomorrow. No automatic payment will occur.", `Annual: ${annual} — Best value`, `Monthly: ${monthly}`, `Choose a plan: ${pricingUrl}`],
    preview_expired: ["Live updates are paused and your last position remains available as read-only.", `Annual: ${annual} — Best value`, `Monthly: ${monthly}`, `Choose a plan: ${pricingUrl}`],
  }[type] || [];
  const safeContent = includeAmounts ? content : content;
  const text = safeContent.join("\n\n");
  const html = safeContent.map((paragraph) => `<p>${escapeEmailHtml(paragraph)}</p>`).join("");
  return { subject: PREVIEW_EMAIL_SUBJECTS[type], text, html, optional };
}

export async function sendPreviewLifecycleEmail({ userId, email, type, period, endDate = null, onboardingStep = "balance", includeAmounts = false } = {}) {
  if (!email || !PREVIEW_EMAIL_SUBJECTS[type]) return { status: "skipped" };
  if (OPTIONAL_TYPES.has(type) && await shouldSuppressOptionalEmail(userId, type)) return { status: "suppressed" };
  const claimed = await claimEmailDelivery({ userId, type, period, transactional: !OPTIONAL_TYPES.has(type) });
  if (!claimed.ok) return { status: claimed.reason === "duplicate" ? "skipped" : "failed" };
  const message = buildPreviewEmail({ type, endDate, onboardingStep, userId, includeAmounts });
  try {
    const response = await sendResendEmail({
      to: email,
      ...message,
      headers: { "X-ClearTill-Email-Type": type, "X-ClearTill-Idempotency-Key": claimed.idempotencyKey },
    });
    if (response.skipped) {
      await markEmailDelivery(claimed.ref, { status: emailFailureStatus(claimed.attempts), reason: response.error }, { claimToken: claimed.claimToken });
      return { status: "skipped" };
    }
    await markEmailDelivery(claimed.ref, { status: "sent", sentAt: FieldValue.serverTimestamp(), providerMessageId: response.providerMessageId || null }, { claimToken: claimed.claimToken });
    return { status: "sent" };
  } catch (error) {
    await markEmailDelivery(claimed.ref, { status: emailFailureStatus(claimed.attempts), reason: String(error?.message || "send_failed").slice(0, 120) }, { claimToken: claimed.claimToken });
    return { status: "failed" };
  }
}
