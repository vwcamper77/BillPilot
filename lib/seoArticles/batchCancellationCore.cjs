"use strict";

const QUEUED_STATUS = "queued";
const COMPLETED_STATUS = "completed";
const FAILED_STATUS = "failed";
const CANCELLED_STATUS = "cancelled";
const BATCH_CANCELLED_STATUS = "cancelled";
const BATCH_PARTIALLY_CANCELLED_STATUS = "partially_cancelled";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function responseIds(record) {
  return [
    record?.openAiResponseId,
    record?.providerResponseId,
    record?.responseId,
    record?.generation?.responseId,
  ].filter(Boolean);
}

function tokenTotal(record) {
  return number(
    record?.tokenUsage?.totalTokens
    ?? record?.tokenUsage?.total
    ?? record?.generation?.usage?.totalTokens,
  );
}

function summariseBatchState({
  batch = {},
  jobs = [],
  drafts = [],
  reviewPackages = [],
} = {}) {
  const counts = jobs.reduce((result, job) => {
    if (job.status === QUEUED_STATUS) result.queued += 1;
    else if (job.status === COMPLETED_STATUS) result.completed += 1;
    else if (job.status === FAILED_STATUS) result.failed += 1;
    else if (job.status === CANCELLED_STATUS) result.cancelled += 1;
    else result.inFlight += 1;
    return result;
  }, {
    queued: 0,
    inFlight: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  });
  const started = jobs.filter((job) => (
    number(job.attempts) > 0
    || Boolean(job.startedAt)
    || ![QUEUED_STATUS, CANCELLED_STATUS].includes(job.status)
  )).length;
  const allRecords = [...jobs, ...drafts];
  return {
    total: number(batch.total) || jobs.length,
    ...counts,
    started,
    articleCount: drafts.length,
    emailCount: reviewPackages.filter((record) => record.status === "sent").length,
    responseIds: allRecords.flatMap(responseIds),
    batchTokenUsage: tokenTotal(batch),
    recordedTokenUsage: allRecords.reduce((sum, record) => sum + tokenTotal(record), 0),
  };
}

function cancellationOutcome(summary) {
  const previouslyStarted = summary.started > 0
    || summary.completed > 0
    || summary.failed > 0
    || summary.articleCount > 0;
  return {
    status: previouslyStarted
      ? BATCH_PARTIALLY_CANCELLED_STATUS
      : BATCH_CANCELLED_STATUS,
    newlyCancelled: summary.queued,
    cancelled: summary.cancelled + summary.queued,
    completed: summary.completed,
    failed: summary.failed,
    inFlight: summary.inFlight,
  };
}

function canCancelBatch(batch, summary) {
  if (!batch || !summary?.queued) return false;
  return ["queued", "running", "in_progress"].includes(batch.status);
}

module.exports = {
  BATCH_CANCELLED_STATUS,
  BATCH_PARTIALLY_CANCELLED_STATUS,
  CANCELLED_STATUS,
  COMPLETED_STATUS,
  FAILED_STATUS,
  QUEUED_STATUS,
  canCancelBatch,
  cancellationOutcome,
  summariseBatchState,
};
