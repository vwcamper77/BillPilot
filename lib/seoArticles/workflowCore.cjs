"use strict";

function dailyRunId(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    throw new Error("Scheduled SEO runs require a YYYY-MM-DD date key.");
  }
  return `daily-${dateKey}`;
}

function shouldGenerateDailyRun(record, now = Date.now()) {
  if (!record) return true;
  if (["draft_ready", "email_pending", "email_sending", "email_sent", "approved", "changes_requested", "rejected"].includes(record.status)) {
    return false;
  }
  if (record.status === "generating" && Number(record.leaseExpiresAtMs || 0) > now) return false;
  return true;
}

function shouldSendReviewEmail(record, now = Date.now()) {
  if (!record || record.emailStatus === "sent") return false;
  if (record.emailStatus === "sending" && Number(record.emailLeaseExpiresAtMs || 0) > now) {
    return false;
  }
  return ["draft_ready", "email_pending", "email_sending"].includes(record.status);
}

function publicationBoundary(action) {
  return {
    action,
    createsPublicationReadyExport: action === "approve",
    writesLiveArticle: false,
    automaticPublication: false,
  };
}

module.exports = {
  dailyRunId,
  publicationBoundary,
  shouldGenerateDailyRun,
  shouldSendReviewEmail,
};
