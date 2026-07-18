import { getAppBaseUrl } from "@/lib/billing/config";
import { buildUnsubscribeUrl } from "@/lib/email";
import { REMINDER_TEMPLATE_VERSION } from "./config";
import { NOTIFICATION_TYPES, ROUTINE_TYPES } from "./policy";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function formatDate(value, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(value));
}

function formatTime(value, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(value));
}

function formatMoney(amountMinor, currency = "gbp") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency).toUpperCase() }).format(Number(amountMinor) / 100);
}

function billWording(bills) {
  const qualities = new Set((bills || []).map((bill) => String(bill.sourceQuality || "scheduled").toLowerCase()));
  if (qualities.size === 1 && qualities.has("pending")) return { adjective: "pending", verb: "pending for" };
  if (qualities.size === 1 && qualities.has("predicted")) return { adjective: "expected", verb: "expected" };
  return { adjective: "scheduled", verb: "scheduled for" };
}

function billSubject(bills) {
  const count = bills.length;
  const wording = billWording(bills);
  if (count === 1) return `A bill is ${wording.verb} tomorrow`;
  return `${count} bills are ${wording.verb} tomorrow`;
}

function relativeBalanceTime(updatedAt, now) {
  if (!updatedAt) return "more than a day ago";
  const hours = Math.max(1, Math.floor((new Date(now).getTime() - new Date(updatedAt).getTime()) / 3600000));
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function renderLayout({ preheader, paragraphs, actions = [], detailRows = [] }) {
  const text = [preheader, ...paragraphs, ...detailRows, ...actions.map((action) => `${action.label}: ${action.href}`)].filter(Boolean).join("\n\n");
  const html = [
    `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>`,
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    detailRows.length ? `<ul>${detailRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : "",
    ...actions.map((action, index) => `<p><a href="${escapeHtml(action.href)}"${index === 0 ? ' style="display:inline-block;padding:12px 18px;border-radius:999px;background:#143c3a;color:#ffffff;font-weight:700;text-decoration:none"' : ""}>${escapeHtml(action.label)}</a></p>`),
  ].join("");
  return { text, html };
}

export function buildReminderEmail({ event, lifecycle, preferences, user, balanceUpdatedAt = null, bills = [], now = new Date() }) {
  const baseUrl = getAppBaseUrl();
  const dashboardUrl = `${baseUrl}/dashboard`;
  const settingsUrl = `${baseUrl}/account#reminders`;
  const billingUrl = `${baseUrl}/billing`;
  const firstName = String(user.firstName || user.displayName || "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const trialEndDate = lifecycle.trialEndsAt ? formatDate(lifecycle.trialEndsAt, preferences.timezone) : "";
  const trialEndTime = lifecycle.trialEndsAt ? formatTime(lifecycle.trialEndsAt, preferences.timezone) : "";
  let subject = "ClearTill reminder";
  let preheader = "Review your ClearTill settings.";
  let paragraphs = [greeting];
  let actions = [];
  let detailRows = [];
  let templateId = "";

  switch (event.type) {
    case NOTIFICATION_TYPES.TRIAL_WELCOME: {
      if (!lifecycle.trialEndsAt || !lifecycle.conversionType) throw new Error("Trial terms are incomplete.");
      templateId = "trial_welcome_reminder_setup";
      subject = "Your 7-day ClearTill trial is active";
      preheader = `Set up reminders and review what happens on ${trialEndDate}.`;
      paragraphs.push(
        `Your 7-day ClearTill trial is active until ${trialEndDate} at ${trialEndTime} ${preferences.timezone}.`,
        "ClearTill can remind you when your balance may need reviewing and when a bill is scheduled for the following day. Guided reminders are daily during the first seven days while your balance is out of date, then become less frequent if paid access continues.",
      );
      if (lifecycle.conversionType === "AUTO_RENEW") {
        if (!lifecycle.planAmountMinor || !lifecycle.planCurrency || !lifecycle.billingInterval || !lifecycle.firstChargeAt || !lifecycle.cancelUrl) throw new Error("Authoritative auto-renewal terms are incomplete.");
        paragraphs.push(`Unless you cancel before the trial ends, your ${lifecycle.planName || "ClearTill"} subscription is scheduled to begin on ${formatDate(lifecycle.firstChargeAt, preferences.timezone)} at ${formatMoney(lifecycle.planAmountMinor, lifecycle.planCurrency)} per ${lifecycle.billingInterval}.`);
      } else {
        paragraphs.push(`Your trial will end on ${trialEndDate}. You will not be charged automatically.`);
      }
      actions = [{ label: "Set up ClearTill reminders", href: settingsUrl }, { label: "Review trial and billing settings", href: lifecycle.cancelUrl || billingUrl }];
      paragraphs.push("You can change, pause, or switch off optional reminders at any time.");
      break;
    }
    case NOTIFICATION_TYPES.DIRECT_PAID_WELCOME:
      templateId = "direct_paid_welcome_reminder_setup";
      subject = "Welcome to ClearTill";
      preheader = "Your paid access is active. Choose your balance and bill reminders.";
      paragraphs.push("Your paid ClearTill access is active.", "ClearTill can remind you when your balance may need reviewing and when a bill is scheduled for the following day. We recommend Guided reminders: daily during your first seven days while your balance is out of date, then gradually less often.", "You can change, pause, or switch off optional reminders at any time.");
      actions = [{ label: "Set up ClearTill reminders", href: settingsUrl }, { label: "Review account settings", href: `${baseUrl}/account` }];
      break;
    case NOTIFICATION_TYPES.TRIAL_SETUP_NUDGE:
      templateId = "trial_setup_nudge";
      subject = "Finish setting up ClearTill";
      preheader = `Your trial runs until ${trialEndDate}.`;
      paragraphs.push(`Your ClearTill trial runs until ${trialEndDate}. Set your reminder preferences and add or review your balance so upcoming-bill reminders can be useful.`);
      actions = [{ label: "Continue setup", href: dashboardUrl }, { label: "Change reminder settings", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.PAID_SETUP_NUDGE:
      templateId = "direct_paid_setup_nudge";
      subject = "Finish setting up your ClearTill reminders";
      preheader = "Choose how balance and bill reminders should work.";
      paragraphs.push("Your paid ClearTill access is active, but your reminder setup is not complete.", "Choose how often ClearTill should prompt you to review your balance and whether to send a reminder before a scheduled bill.");
      actions = [{ label: "Finish reminder setup", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.TRIAL_ENDING_SOON:
      if (!lifecycle.trialEndsAt || !lifecycle.conversionType) throw new Error("Trial terms are incomplete.");
      templateId = lifecycle.conversionType === "AUTO_RENEW" ? "trial_ending_soon_auto_renew" : "trial_ending_soon_manual_conversion";
      subject = `Your ClearTill trial ends on ${trialEndDate}`;
      if (lifecycle.conversionType === "AUTO_RENEW") {
        if (!lifecycle.planAmountMinor || !lifecycle.planCurrency || !lifecycle.billingInterval || !lifecycle.firstChargeAt || !lifecycle.cancelUrl) throw new Error("Authoritative auto-renewal terms are incomplete.");
        preheader = "Your paid subscription is scheduled to start after the trial.";
        paragraphs.push(`Your ClearTill trial ends on ${trialEndDate} at ${trialEndTime} ${preferences.timezone}.`, `Unless you cancel before then, your ${lifecycle.planName || "ClearTill"} subscription is scheduled to begin on ${formatDate(lifecycle.firstChargeAt, preferences.timezone)} at ${formatMoney(lifecycle.planAmountMinor, lifecycle.planCurrency)} per ${lifecycle.billingInterval}.`, "Your existing reminder settings will continue if paid access becomes active.");
        actions = [{ label: "Review subscription and billing", href: billingUrl }, { label: "Manage or cancel trial", href: lifecycle.cancelUrl }];
      } else {
        preheader = "Routine reminders will pause if paid access does not continue.";
        paragraphs.push(`Your ClearTill trial ends on ${trialEndDate} at ${trialEndTime} ${preferences.timezone}. You will not be charged automatically.`, "If paid access is not active when the trial ends, routine balance and bill reminder emails will pause.");
        actions = [{ label: "Review trial status", href: `${baseUrl}/account` }, { label: "Review reminder settings", href: settingsUrl }];
      }
      break;
    case NOTIFICATION_TYPES.TRIAL_CONVERTED_TO_PAID:
      templateId = "trial_converted_to_paid";
      subject = "Your ClearTill paid access is active";
      preheader = "Your reminder settings will continue.";
      paragraphs.push("Your ClearTill trial has ended and your paid access is active.", "Your existing balance and bill reminder settings will continue. We have not restarted the seven-day onboarding cadence.");
      actions = [{ label: "Review ClearTill", href: dashboardUrl }, { label: "Review reminder settings", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.TRIAL_EXPIRED:
      templateId = "trial_expired";
      subject = "Your ClearTill trial has ended";
      preheader = "Routine reminders are paused because paid access is not active.";
      paragraphs.push(`Your ClearTill trial ended on ${trialEndDate}. Paid access is not active, so routine balance and bill reminder emails are paused.`, "Your last ClearTill position remains available as read-only according to the current access policy.");
      actions = [{ label: "Review account status", href: `${baseUrl}/account` }, { label: "Manage reminder settings", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.BALANCE_STALE:
      templateId = "balance_stale_reminder";
      subject = "Your ClearTill balance may need updating";
      preheader = `It was last reviewed ${relativeBalanceTime(balanceUpdatedAt, now)}.`;
      paragraphs.push(`Your ClearTill balance was last reviewed ${relativeBalanceTime(balanceUpdatedAt, now)}. Updating it helps keep your upcoming-bill view accurate.`);
      actions = [{ label: "Review or update balance", href: `${dashboardUrl}?focus=balance&reminder=balance_stale` }, { label: "Snooze or change reminder frequency", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.BILL_DUE_TOMORROW:
    case NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE: {
      const combined = event.type === NOTIFICATION_TYPES.BILL_AND_BALANCE_STALE;
      templateId = combined ? "bill_and_balance_reminder" : (preferences.privacyMode === "DETAILED" ? "bill_due_tomorrow_detailed" : "bill_due_tomorrow_private");
      subject = billSubject(bills);
      preheader = combined ? `Your ClearTill balance was last reviewed ${relativeBalanceTime(balanceUpdatedAt, now)}.` : `Review ${formatDate(`${event.tomorrowIso}T12:00:00Z`, "UTC")} securely in ClearTill.`;
      paragraphs.push(`You have ${bills.length} ${bills.length === 1 ? "bill" : "bills"} ${billWording(bills).verb} tomorrow${combined ? `. Your ClearTill balance was last reviewed ${relativeBalanceTime(balanceUpdatedAt, now)}.` : "."}`);
      if (combined) paragraphs.push("Review your bills and update your balance in one place.");
      if (preferences.privacyMode === "DETAILED") {
        detailRows = bills.map((bill) => `${bill.name || "Scheduled bill"} — ${formatMoney(Math.round(Number(bill.amount || 0) * 100), bill.currency || "GBP")}`);
        paragraphs.push("These details may be visible in inbox previews, on shared devices or if this email is forwarded. You can return to Private mode in reminder settings.");
      } else {
        paragraphs.push("Financial details are hidden from this email. You can change this in reminder settings.");
      }
      actions = [{ label: combined ? "Review and update" : "Review tomorrow's bills", href: `${dashboardUrl}?focus=bills&reminder=bill_due_tomorrow` }, { label: "Manage reminders", href: settingsUrl }];
      break;
    }
    case NOTIFICATION_TYPES.BALANCE_REMINDERS_PAUSED:
      templateId = "balance_reminders_paused";
      subject = "Routine balance reminders are paused";
      preheader = "Your bill alerts remain unchanged.";
      paragraphs.push("We have paused routine balance emails because there has not been a balance update or relevant ClearTill activity for 30 days.", "Your enabled bill alerts will continue. You can resume balance reminders whenever they are useful.");
      actions = [{ label: "Review reminder settings", href: settingsUrl }];
      break;
    case NOTIFICATION_TYPES.PREFERENCES_CHANGED:
      templateId = "reminder_preferences_changed";
      subject = "Your ClearTill reminder settings were updated";
      preheader = "Review your current reminder preferences.";
      paragraphs.push("Your ClearTill reminder settings were updated.", "If you did not make this change, sign in to ClearTill and review your account security.");
      detailRows = [
        `Balance reminders: ${preferences.balanceReminderMode}`,
        `Reminder time: ${preferences.preferredReminderTime} ${preferences.timezone}`,
        `Bill alerts: ${preferences.billRemindersEnabled ? "One day before" : "Off"}`,
        `Email detail: ${preferences.privacyMode}`,
      ];
      actions = [{ label: "Review settings", href: settingsUrl }];
      break;
    default:
      throw new Error(`Unsupported reminder template: ${event.type}`);
  }

  if (ROUTINE_TYPES.has(event.type)) {
    actions.push({ label: "Turn off optional reminders", href: buildUnsubscribeUrl({ userId: lifecycle.uid, type: event.type }) });
  }

  const rendered = renderLayout({ preheader, paragraphs, actions, detailRows });
  return { templateId, templateVersion: REMINDER_TEMPLATE_VERSION, subject, preheader, ...rendered };
}
