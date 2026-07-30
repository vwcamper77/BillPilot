import crypto from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import cancellationCore from "@/lib/seoArticles/batchCancellationCore.cjs";
import contentPlan from "@/lib/seoArticles/contentPlan.cjs";

const {
  canCancelBatch,
  cancellationOutcome,
  summariseBatchState,
} = cancellationCore;
const { createControlledReplacementPreview } = contentPlan;

const BATCHES_COLLECTION = "seoGenerationBatches";
const JOBS_COLLECTION = "seoGenerationJobs";
const DRAFTS_COLLECTION = "seoArticleDrafts";
const REVIEW_PACKAGES_COLLECTION = "seoArticleReviewPackages";
const OPERATIONS_COLLECTION = "seoContentOperations";
const CALENDAR_COLLECTION = "seoContentCalendar";
const MAX_BATCH_JOBS = 10;
export const BATCH_CANCELLATION_REASON =
  "Cancelled before generation due to invalid topic composition";

function safeActor(actor) {
  return {
    uid: String(actor?.uid || ""),
    email: String(actor?.email || "").trim().toLowerCase(),
  };
}

function cancellationAuditId(batchId) {
  return crypto
    .createHash("sha256")
    .update(`cancel_generation_batch:${batchId}`)
    .digest("hex");
}

function cancellationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateBatchId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) {
    throw cancellationError("seo/batch-id-invalid", "Choose a valid generation batch.");
  }
  return id;
}

async function resolveBatchRef(db, requestedId) {
  const id = validateBatchId(requestedId);
  const exactRef = db.collection(BATCHES_COLLECTION).doc(id);
  const exact = await exactRef.get();
  if (exact.exists) return exactRef;

  const matches = await db.collection(BATCHES_COLLECTION)
    .orderBy(FieldPath.documentId())
    .startAt(id)
    .endAt(`${id}\uf8ff`)
    .limit(2)
    .get();
  if (matches.empty) {
    throw cancellationError("seo/batch-not-found", "Generation batch not found.");
  }
  if (matches.size !== 1) {
    throw cancellationError(
      "seo/batch-id-ambiguous",
      "That shortened batch ID matches more than one batch. Open the batch and use its full ID.",
    );
  }
  return matches.docs[0].ref;
}

function records(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function jobsQuery(db, batchId) {
  return db.collection(JOBS_COLLECTION)
    .where("batchId", "==", batchId)
    .limit(MAX_BATCH_JOBS + 1);
}

function draftsQuery(db, batchId) {
  return db.collection(DRAFTS_COLLECTION)
    .where("batchId", "==", batchId)
    .limit(MAX_BATCH_JOBS + 1);
}

async function readReviewPackages(transaction, db, drafts) {
  const articleIds = drafts.map((draft) => draft.id).slice(0, MAX_BATCH_JOBS);
  if (!articleIds.length) return [];
  const snapshot = await transaction.get(
    db.collection(REVIEW_PACKAGES_COLLECTION)
      .where("articleId", "in", articleIds)
      .limit(MAX_BATCH_JOBS * 2),
  );
  return records(snapshot);
}

function replacementCalendarFields(topic) {
  return Object.fromEntries([
    "provisionalTitle",
    "primaryKeyword",
    "secondaryKeywords",
    "category",
    "contentCluster",
    "searchIntent",
    "funnelStage",
    "audience",
    "seasonalRelevance",
    "evergreenOrAdaptive",
    "articleType",
    "proposedCta",
    "proposedInternalLinks",
    "supportingAssetRequirement",
    "priority",
    "rationale",
  ].map((field) => [field, topic[field]]));
}

function resultFor({
  batchId,
  summary,
  outcome,
  duplicatePrevented,
  now,
  replacementPreview = [],
}) {
  const fullyCancelled = outcome.status === "cancelled";
  return {
    ok: true,
    batchId,
    status: outcome.status,
    cancelledJobs: outcome.cancelled,
    newlyCancelledJobs: outcome.newlyCancelled,
    completedJobs: outcome.completed,
    failedJobs: outcome.failed,
    inFlightJobs: outcome.inFlight,
    startedJobs: summary.started,
    totalJobs: summary.total,
    progress: `${outcome.completed}/${summary.total}`,
    tokenUsage: summary.batchTokenUsage,
    recordedTokenUsage: summary.recordedTokenUsage,
    articleCount: summary.articleCount,
    emailCount: summary.emailCount,
    openAiResponseCount: summary.responseIds.length,
    reason: BATCH_CANCELLATION_REASON,
    replacementPreview,
    cancelledAt: now.toISOString(),
    duplicatePrevented,
    published: false,
    messageTitle: fullyCancelled ? "Batch cancelled" : "Batch partially cancelled",
    message: fullyCancelled
      ? `Batch ${batchId.slice(0, 8)} was cancelled before generation. No articles or review emails were created.`
      : `Batch ${batchId.slice(0, 8)} will stop after the current job. Completed articles were retained and all remaining queued jobs were cancelled.`,
  };
}

export async function inspectSeoGenerationBatch(batchId, {
  db = getAdminDb(),
} = {}) {
  const batchRef = await resolveBatchRef(db, batchId);
  const [batchSnapshot, jobSnapshot, draftSnapshot] = await Promise.all([
    batchRef.get(),
    jobsQuery(db, batchRef.id).get(),
    draftsQuery(db, batchRef.id).get(),
  ]);
  if (!batchSnapshot.exists) {
    throw cancellationError("seo/batch-not-found", "Generation batch not found.");
  }
  const drafts = records(draftSnapshot);
  let reviewPackages = [];
  if (drafts.length) {
    const articleIds = drafts.map((draft) => draft.id).slice(0, MAX_BATCH_JOBS);
    reviewPackages = records(await db.collection(REVIEW_PACKAGES_COLLECTION)
      .where("articleId", "in", articleIds)
      .limit(MAX_BATCH_JOBS * 2)
      .get());
  }
  return {
    batchId: batchRef.id,
    batch: batchSnapshot.data(),
    jobs: records(jobSnapshot),
    drafts,
    reviewPackages,
    summary: summariseBatchState({
      batch: batchSnapshot.data(),
      jobs: records(jobSnapshot),
      drafts,
      reviewPackages,
    }),
  };
}

export async function cancelSeoGenerationBatch({
  batchId,
  actor,
  prepareControlledPreview = false,
  now = new Date(),
  db = getAdminDb(),
} = {}) {
  const batchRef = await resolveBatchRef(db, batchId);
  const auditRef = db.collection(OPERATIONS_COLLECTION)
    .doc(cancellationAuditId(batchRef.id));
  return db.runTransaction(async (transaction) => {
    const [batchSnapshot, auditSnapshot, jobSnapshot, draftSnapshot] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(auditRef),
      transaction.get(jobsQuery(db, batchRef.id)),
      transaction.get(draftsQuery(db, batchRef.id)),
    ]);
    if (auditSnapshot.data()?.status === "completed") {
      return {
        ...auditSnapshot.data().result,
        duplicatePrevented: true,
      };
    }
    if (!batchSnapshot.exists) {
      throw cancellationError("seo/batch-not-found", "Generation batch not found.");
    }
    if (jobSnapshot.size > MAX_BATCH_JOBS) {
      throw cancellationError("seo/batch-too-large", "The generation batch exceeds the supported safety limit.");
    }
    const jobs = records(jobSnapshot);
    const drafts = records(draftSnapshot);
    const reviewPackages = await readReviewPackages(transaction, db, drafts);
    const summary = summariseBatchState({
      batch: batchSnapshot.data(),
      jobs,
      drafts,
      reviewPackages,
    });
    const outcome = cancellationOutcome(summary);
    const alreadyFinal = ["cancelled", "partially_cancelled"].includes(batchSnapshot.data()?.status);
    if (!alreadyFinal && !canCancelBatch(batchSnapshot.data(), summary)) {
      throw cancellationError(
        "seo/batch-not-cancellable",
        "This batch has no unstarted jobs left to cancel.",
      );
    }
    const cancelledBy = safeActor(actor);
    const queuedJobs = jobs
      .filter((item) => item.status === "queued")
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
    const replacementTopics = prepareControlledPreview
      ? createControlledReplacementPreview().slice(0, queuedJobs.length)
      : [];
    const replacementByCalendarId = new Map(
      queuedJobs.slice(0, replacementTopics.length).map((job, index) => [
        job.calendarItemId,
        replacementTopics[index],
      ]),
    );
    const replacementPreview = queuedJobs
      .slice(0, replacementTopics.length)
      .map((job, index) => ({
        calendarItemId: job.calendarItemId,
        proposedPublicationDate: job.brief?.proposedPublicationDate || null,
        provisionalTitle: replacementTopics[index].provisionalTitle,
        primaryKeyword: replacementTopics[index].primaryKeyword,
        category: replacementTopics[index].category,
        searchIntent: replacementTopics[index].searchIntent,
        evergreenOrAdaptive: replacementTopics[index].evergreenOrAdaptive,
        rationale: replacementTopics[index].rationale,
        overlapResult: "passed",
      }));
    const result = resultFor({
      batchId: batchRef.id,
      summary,
      outcome,
      duplicatePrevented: false,
      now,
      replacementPreview,
    });

    for (const job of queuedJobs) {
      transaction.update(db.collection(JOBS_COLLECTION).doc(job.id), {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy,
        cancellationReason: BATCH_CANCELLATION_REASON,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (job.calendarItemId) {
        const replacement = replacementByCalendarId.get(job.calendarItemId);
        transaction.set(db.collection(CALENDAR_COLLECTION).doc(job.calendarItemId), {
          ...(replacement ? replacementCalendarFields(replacement) : {}),
          status: "planned",
          generationBatchId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    transaction.set(batchRef, {
      status: outcome.status,
      cancelled: outcome.cancelled,
      cancellationRequested: true,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy,
      cancellationReason: BATCH_CANCELLATION_REASON,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(auditRef, {
      action: "cancel_generation_batch",
      status: "completed",
      batchId: batchRef.id,
      actor: cancelledBy,
      reason: BATCH_CANCELLATION_REASON,
      before: summary,
      result,
      completedAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

export {
  MAX_BATCH_JOBS,
  cancellationAuditId,
};
