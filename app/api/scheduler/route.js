import { NextResponse } from "next/server";
import { claimEmailDelivery, markEmailDelivery, buildEmailPreview, buildUnsubscribeUrl, sendResendEmail, shouldSuppressOptionalEmail } from "@/lib/email";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { getAppBaseUrl } from "@/lib/billing/config";
import { trackServerAnalyticsEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isSchedulerRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const summary = {
    ok: true,
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    suppressed: 0,
  };

  const usersSnapshot = await getAdminDb().collection("users").get();
  const today = new Date();
  const weekday = today.getUTCDay();

  for (const userDoc of usersSnapshot.docs) {
    const user = userDoc.data();
    const userId = userDoc.id;
    const [subscriptionSnap, billsSnapshot, balanceSnapshot] = await Promise.all([
      userDoc.ref.collection("billing").doc("subscription").get(),
      userDoc.ref.collection("bills").where("active", "==", true).get(),
      userDoc.ref.collection("settings").doc("balance").get(),
    ]);
    const subscription = subscriptionSnap.exists ? subscriptionSnap.data() : {};
    const email = user.email || subscription.customerEmail || "";

    if (!email) {
      summary.skipped += 1;
      continue;
    }

    const billCount = billsSnapshot.size;
    const billsTotal = billsSnapshot.docs.reduce((sum, doc) => sum + (Number(doc.data().amount) || 0), 0);
    const preview = buildEmailPreview({ billCount, billsTotal });
    const balanceLink = `${getAppBaseUrl()}/dashboard?focus=balance`;

    if (weekday === 0 || weekday === 1) {
      summary.attempted += 1;
      const result = await sendOptionalReminder({
        userId,
        email,
        type: "weekly_planning",
        period: `${today.toISOString().slice(0, 10)}:weekly`,
        subject: "Plan your week with ClearTill",
        text: [
          "Update your current balance to see what you really have available after upcoming bills.",
          preview,
          `Update my balance: ${balanceLink}`,
          `Unsubscribe: ${buildUnsubscribeUrl({ userId, type: "weekly_planning" })}`,
        ].filter(Boolean).join("\n\n"),
        html: `<p>Update your current balance to see what you really have available after upcoming bills.</p>${preview ? `<p>${preview}</p>` : ""}<p><a href="${balanceLink}">Update my balance</a></p><p><a href="${buildUnsubscribeUrl({ userId, type: "weekly_planning" })}">Unsubscribe from weekly reminders</a></p>`,
      });
      applyReminderSummary(summary, result);
    }

    if (weekday === 3) {
      summary.attempted += 1;
      const result = await sendOptionalReminder({
        userId,
        email,
        type: "midweek_balance",
        period: `${today.toISOString().slice(0, 10)}:midweek`,
        subject: "Still clear until payday?",
        text: [
          "Refresh your balance and see whether this week's spending has changed your position.",
          preview,
          `Check what's left: ${balanceLink}`,
          `Unsubscribe: ${buildUnsubscribeUrl({ userId, type: "midweek_balance" })}`,
        ].filter(Boolean).join("\n\n"),
        html: `<p>Refresh your balance and see whether this week's spending has changed your position.</p>${preview ? `<p>${preview}</p>` : ""}<p><a href="${balanceLink}">Check what's left</a></p><p><a href="${buildUnsubscribeUrl({ userId, type: "midweek_balance" })}">Unsubscribe from weekly reminders</a></p>`,
      });
      applyReminderSummary(summary, result);
    }

    if (subscription.subscriptionStatus === "trialing" && subscription.trialEnd) {
      await queueTrialEmail(summary, { userId, email, subscription });
    }

    if (subscription.latestInvoiceStatus === "payment_failed") {
      await queueFailedPaymentEmail(summary, { userId, email });
    }

    await userDoc.ref.collection("scheduler").doc("latest").set({
      ranAt: FieldValue.serverTimestamp(),
      lastBalanceSeen: balanceSnapshot.exists ? Boolean(balanceSnapshot.data()?.currentBalance >= 0) : false,
    }, { merge: true });
  }

  return NextResponse.json(summary);
}

function isSchedulerRequest(request) {
  const secret = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function sendOptionalReminder({ userId, email, type, period, subject, text, html }) {
  if (await shouldSuppressOptionalEmail(userId, type)) {
    return { status: "suppressed" };
  }

  const claimed = await claimEmailDelivery({ userId, type, period, transactional: false });
  if (!claimed.ok) {
    return { status: claimed.reason === "duplicate" ? "skipped" : "failed" };
  }

  try {
    const response = await sendResendEmail({
      to: email,
      subject,
      text,
      html,
      headers: {
        "X-ClearTill-Email-Type": type,
        "X-ClearTill-Idempotency-Key": claimed.idempotencyKey,
      },
    });

    if (response.skipped) {
      await markEmailDelivery(claimed.ref, { status: "skipped", reason: response.error });
      return { status: "skipped" };
    }

    await markEmailDelivery(claimed.ref, { status: "sent" });
    await trackServerAnalyticsEvent("trial_reminder_sent", { uid: userId, reminderType: type });
    return { status: "sent" };
  } catch (error) {
    await markEmailDelivery(claimed.ref, { status: "failed", reason: String(error?.message || "send_failed").slice(0, 120) });
    return { status: "failed" };
  }
}

async function queueTrialEmail(summary, { userId, email, subscription }) {
  const now = Date.now();
  const trialEnd = Number(subscription.trialEnd || 0);
  const balanceLink = `${getAppBaseUrl()}/dashboard?focus=balance`;

  if (subscription.trialWelcomeSentAt !== true) {
    summary.attempted += 1;
    const result = await sendOptionalReminder({
      userId,
      email,
      type: "trial_start",
      period: subscription.stripeSubscriptionId || `${trialEnd}:start`,
      subject: "Welcome to your ClearTill trial",
      text: `Your 7-day trial is live. First payment: £1.99 on ${new Date(trialEnd).toLocaleDateString("en-GB")} and monthly after that.\n\nManage your subscription in billing.\n\nUpdate my balance: ${balanceLink}`,
      html: `<p>Your 7-day trial is live.</p><p>First payment: £1.99 on ${new Date(trialEnd).toLocaleDateString("en-GB")} and monthly after that.</p><p><a href="${balanceLink}">Update my balance</a></p>`,
    });
    applyReminderSummary(summary, result);
  }

  if (trialEnd - now <= 48 * 60 * 60 * 1000 && trialEnd > now) {
    summary.attempted += 1;
    const result = await sendOptionalReminder({
      userId,
      email,
      type: "trial_ending",
      period: `${subscription.stripeSubscriptionId || "trial"}:ending`,
      subject: "Your ClearTill trial is nearly over",
      text: `Your first £1.99 monthly payment is due on ${new Date(trialEnd).toLocaleDateString("en-GB")}. Manage or cancel your subscription before then if you need to.`,
      html: `<p>Your first £1.99 monthly payment is due on ${new Date(trialEnd).toLocaleDateString("en-GB")}.</p><p>Manage or cancel your subscription before then if you need to.</p>`,
    });
    applyReminderSummary(summary, result);
  }
}

async function queueFailedPaymentEmail(summary, { userId, email }) {
  summary.attempted += 1;
  const result = await sendOptionalReminder({
    userId,
    email,
    type: "payment_failed",
    period: `${new Date().toISOString().slice(0, 10)}:payment_failed`,
    subject: "Your ClearTill payment needs attention",
    text: `We couldn't take your £1.99 monthly payment. Update your payment details in the Customer Portal to keep access.`,
    html: "<p>We couldn't take your £1.99 monthly payment.</p><p>Update your payment details in the Customer Portal to keep access.</p>",
  });
  applyReminderSummary(summary, result);
}

function applyReminderSummary(summary, result) {
  if (result.status === "sent") summary.sent += 1;
  else if (result.status === "suppressed") summary.suppressed += 1;
  else if (result.status === "failed") summary.failed += 1;
  else summary.skipped += 1;
}
