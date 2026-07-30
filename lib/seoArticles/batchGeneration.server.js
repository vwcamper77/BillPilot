import crypto from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { validateJournalInternalLinks } from "@/lib/journal/repository.server";
import generation from "@/lib/seoArticles/articleGeneration.cjs";
import {
  generateStructuredSeoArticle,
  reviewIndependentSeoArticle,
  reviewSeoHeroVision,
} from "@/lib/seoArticles/openai.server";
import nativeHero from "@/lib/seoArticles/nativeHero.cjs";
import heroQuality from "@/lib/seoArticles/heroQuality.cjs";
import pipeline from "@/lib/seoArticles/pipelineCore.cjs";

const { runDeterministicQualityGates } = generation;
const { generateNativeHero } = nativeHero;
const { generateHeroWithQualityGate } = heroQuality;
const { DEFAULT_SETTINGS, validateSettings } = pipeline;

const COLLECTIONS = Object.freeze({
  settings: "seoContentSettings",
  jobs: "seoGenerationJobs",
  batches: "seoGenerationBatches",
  calendar: "seoContentCalendar",
  drafts: "seoArticleDrafts",
  images: "seoArticleDraftImages",
  versions: "seoArticleVersions",
  versionAssets: "seoArticleVersionAssets",
  transitions: "seoContentTransitions",
  metrics: "seoArticleMetrics",
});

const LEASE_MS = 15 * 60 * 1000;

function usageTotal(...records) {
  return records.flat().filter(Boolean).reduce((total, usage) => ({
    inputTokens: total.inputTokens + Number(usage.inputTokens || 0),
    cachedInputTokens: total.cachedInputTokens + Number(usage.cachedInputTokens || 0),
    outputTokens: total.outputTokens + Number(usage.outputTokens || 0),
    reasoningTokens: total.reasoningTokens + Number(usage.reasoningTokens || 0),
    totalTokens: total.totalTokens + Number(usage.totalTokens || 0),
  }), {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  });
}

function transitionId(jobId, status, attempt) {
  return crypto
    .createHash("sha256")
    .update(`${jobId}:${status}:${attempt}`)
    .digest("hex");
}

async function updateStage(jobRef, status, extra = {}) {
  await jobRef.update({
    status,
    ...extra,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function settings(db) {
  const snapshot = await db.collection(COLLECTIONS.settings).doc("default").get();
  return validateSettings(snapshot.exists ? snapshot.data() : DEFAULT_SETTINGS);
}

async function claimNextJob(db, now) {
  const snapshot = await db.collection(COLLECTIONS.jobs)
    .where("status", "==", "queued")
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const jobRef = snapshot.docs[0].ref;
  const leaseId = crypto.randomUUID();
  return db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(jobRef);
    if (fresh.data()?.status !== "queued") return null;
    const attempt = Number(fresh.data()?.attempts || 0) + 1;
    transaction.update(jobRef, {
      status: "researching",
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: attempt,
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection(COLLECTIONS.calendar).doc(fresh.data().calendarItemId), {
      status: "generating",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection(COLLECTIONS.batches).doc(fresh.data().batchId), {
      status: "in_progress",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(
      db.collection(COLLECTIONS.transitions).doc(transitionId(fresh.id, "generating", attempt)),
      {
        entityId: fresh.data().calendarItemId,
        previousStatus: "research_ready",
        newStatus: "generating",
        actor: { uid: "seo-generation-worker", email: "" },
        timestamp: FieldValue.serverTimestamp(),
        articleId: null,
        versionId: null,
        safeReason: "Administrator-enabled background generation job started.",
        sourceAction: "generation_worker",
      },
    );
    return { id: fresh.id, ref: jobRef, leaseId, attempt, ...fresh.data() };
  });
}

async function failJob(db, job, error) {
  await db.runTransaction(async (transaction) => {
    const batchRef = db.collection(COLLECTIONS.batches).doc(job.batchId);
    const [fresh, batchSnapshot] = await Promise.all([
      transaction.get(job.ref),
      transaction.get(batchRef),
    ]);
    if (fresh.data()?.leaseId !== job.leaseId) return;
    const batch = batchSnapshot.data() || {};
    const nextFailed = Number(batch.failed || 0) + 1;
    const terminal = Number(batch.completed || 0) + nextFailed >= Number(batch.total || 0);
    transaction.update(job.ref, {
      status: "failed",
      errorCode: error?.code || "seo/batch-generation-failed",
      safeError: "This article job failed. Review the server logs before retrying.",
      leaseId: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection(COLLECTIONS.calendar).doc(job.calendarItemId), {
      status: "generation_failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(batchRef, {
      failed: nextFailed,
      status: terminal ? "completed_with_failures" : "in_progress",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(db.collection(COLLECTIONS.metrics).doc("aggregate"), {
      generationFailures: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(
      db.collection(COLLECTIONS.transitions).doc(transitionId(job.id, "generation_failed", job.attempt)),
      {
        entityId: job.calendarItemId,
        previousStatus: "generating",
        newStatus: "generation_failed",
        actor: { uid: "seo-generation-worker", email: "" },
        timestamp: FieldValue.serverTimestamp(),
        articleId: null,
        versionId: null,
        safeReason: "Background generation failed; no other batch job was blocked.",
        sourceAction: "generation_worker",
      },
    );
  });
}

export async function processNextSeoGenerationJob({
  now = new Date(),
  generate = generateStructuredSeoArticle,
  editorialReview = reviewIndependentSeoArticle,
  renderHero = generateNativeHero,
  visionReview = reviewSeoHeroVision,
} = {}) {
  const db = getAdminDb();
  const currentSettings = await settings(db);
  if (!currentSettings.generationEnabled) {
    const error = new Error("Content generation is disabled in SEO settings.");
    error.code = "seo/generation-disabled";
    throw error;
  }
  const job = await claimNextJob(db, now);
  if (!job) return { ok: true, processed: false, reason: "No queued generation job." };
  try {
    const brief = job.brief || {};
    const generated = await generate({
      dateKey: String(brief.proposedPublicationDate || "").slice(0, 10),
      topic: brief.provisionalTitle,
      brief,
    });
    const internalLinks = await validateJournalInternalLinks(brief.proposedInternalLinks || []);
    if (!internalLinks.passed) {
      const error = new Error("The approved brief contains an invalid Journal internal link.");
      error.code = "seo/internal-link-invalid";
      throw error;
    }
    generated.article.internalLinks = internalLinks.paths;
    generated.article.cta = {
      title: String(brief.proposedCta || "Know what’s spoken for—and what isn’t."),
      label: String(brief.proposedCta || "Start my no-card preview"),
      href: "/start",
    };
    await updateStage(job.ref, "writing");
    const qualityReport = runDeterministicQualityGates(generated, { contentId: job.id });
    qualityReport.checks.internalLinks = true;
    await updateStage(job.ref, "validating", { qualityReport });
    if (!qualityReport.passed) {
      const error = new Error("Deterministic quality gates failed.");
      error.code = "seo/quality-gates-failed";
      throw error;
    }
    const editorial = await editorialReview({
      article: generated.article,
      claims: generated.claims,
      sources: generated.sources,
      qualityReport,
    });
    await updateStage(job.ref, "hero_rendering", {
      editorialSummary: {
        score: editorial.score,
        recommendation: editorial.recommendation,
      },
    });
    const heroResult = await generateHeroWithQualityGate({
      article: generated.article,
      heroTitle: generated.heroTitle,
      altText: generated.heroAltText,
      render: renderHero,
      reviewVision: visionReview,
    });
    await updateStage(job.ref, "vision_review");
    if (!heroResult.hero || heroResult.qa?.passed !== true) {
      const error = new Error("Hero image QA failed.");
      error.code = "seo/hero-qa-failed";
      throw error;
    }
    const hero = heroResult.hero;
    const draftId = crypto.randomUUID();
    const versionId = "v1";
    const versionDocumentId = `${draftId}__${versionId}`;
    const visionUsage = (heroResult.qa?.attemptDiagnostics || [])
      .map((attempt) => attempt.visionUsage)
      .filter(Boolean);
    const usage = usageTotal(
      generated.generation?.usage,
      editorial.usage,
      visionUsage,
    );
    const draftRef = db.collection(COLLECTIONS.drafts).doc(draftId);
    const imageRef = db.collection(COLLECTIONS.images).doc(draftId);
    const versionRef = db.collection(COLLECTIONS.versions).doc(versionDocumentId);
    const assetRef = db.collection(COLLECTIONS.versionAssets).doc(versionDocumentId);
    await db.runTransaction(async (transaction) => {
      const batchRef = db.collection(COLLECTIONS.batches).doc(job.batchId);
      const metricsRef = db.collection(COLLECTIONS.metrics).doc("aggregate");
      const [fresh, batchSnapshot, metricsSnapshot] = await Promise.all([
        transaction.get(job.ref),
        transaction.get(batchRef),
        transaction.get(metricsRef),
      ]);
      if (fresh.data()?.leaseId !== job.leaseId) throw new Error("Generation job lease expired.");
      const batch = batchSnapshot.data() || {};
      const nextCompleted = Number(batch.completed || 0) + 1;
      const terminal = nextCompleted + Number(batch.failed || 0) >= Number(batch.total || 0);
      const checkValues = Object.values(qualityReport?.checks || {});
      const articleScore = checkValues.length
        ? Math.round((checkValues.filter(Boolean).length / checkValues.length) * 100)
        : 0;
      const heroScore = Number(heroResult.qa?.visionScore || 0);
      const priorMetrics = metricsSnapshot.data() || {};
      const scoreCount = Number(priorMetrics.articleScoreCount || 0) + 1;
      const articleScoreSum = Number(priorMetrics.articleScoreSum || 0) + articleScore;
      const heroScoreSum = Number(priorMetrics.heroScoreSum || 0) + heroScore;
      const draft = {
        draftId,
        runId: job.batchId,
        batchId: job.batchId,
        generationJobId: job.id,
        calendarItemId: job.calendarItemId,
        status: "review_ready",
        currentVersion: 1,
        article: generated.article,
        heroTitle: hero.heroTitle,
        claims: generated.claims,
        sources: generated.sources,
        generation: generated.generation,
        qualityReport,
        editorialReview: editorial,
        imageQa: heroResult.qa,
        imageReviewRequired: false,
        duplicateRisk: brief.duplicateRisk || { passed: true },
        tokenUsage: usage,
        publication: { exportReady: false, published: false },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      const image = {
        draftId,
        versionId,
        source: "cleartill_native",
        mediaType: hero.mediaType,
        width: hero.width,
        height: hero.height,
        mobileWidth: hero.mobileWidth,
        mobileHeight: hero.mobileHeight,
        alt: hero.alt,
        heroTitle: hero.heroTitle,
        layoutVariant: hero.layoutVariant,
        layoutValidation: hero.layoutValidation,
        svg: hero.svg,
        pngBase64: hero.png.toString("base64"),
        mobilePngBase64: hero.mobilePng.toString("base64"),
        imageReviewRequired: false,
        qa: heroResult.qa,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.create(draftRef, draft);
      transaction.create(imageRef, image);
      transaction.create(versionRef, {
        schemaVersion: "cleartill-seo-article-version-v1",
        articleId: draftId,
        versionId,
        calendarItemId: job.calendarItemId,
        article: generated.article,
        claims: generated.claims,
        sources: generated.sources,
        generation: generated.generation,
        qualityReport,
        editorialReview: editorial,
        hero: {
          assetDocumentId: versionDocumentId,
          heroTitle: hero.heroTitle,
          layoutVariant: hero.layoutVariant,
          qa: heroResult.qa,
          width: hero.width,
          height: hero.height,
          mobileWidth: hero.mobileWidth,
          mobileHeight: hero.mobileHeight,
        },
        tokenUsage: usage,
        immutable: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(assetRef, {
        articleId: draftId,
        versionId,
        svg: image.svg,
        pngBase64: image.pngBase64,
        mobilePngBase64: image.mobilePngBase64,
        mediaType: image.mediaType,
        immutable: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(job.ref, {
        status: "completed",
        articleId: draftId,
        versionId,
        tokenUsage: usage,
        leaseId: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(db.collection(COLLECTIONS.calendar).doc(job.calendarItemId), {
        articleId: draftId,
        versionId,
        status: "review_ready",
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(batchRef, {
        completed: nextCompleted,
        status: terminal
          ? (Number(batch.failed || 0) ? "completed_with_failures" : "completed")
          : "in_progress",
        tokenUsage: {
          inputTokens: FieldValue.increment(usage.inputTokens),
          outputTokens: FieldValue.increment(usage.outputTokens),
          totalTokens: FieldValue.increment(usage.totalTokens),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(metricsRef, {
        draftsGenerated: FieldValue.increment(1),
        generatedDrafts: FieldValue.increment(1),
        awaitingReview: FieldValue.increment(1),
        articleScoreCount: scoreCount,
        articleScoreSum,
        heroScoreSum,
        averageArticleQuality: Math.round(articleScoreSum / scoreCount),
        averageHeroScore: Math.round(heroScoreSum / scoreCount),
        openAiInputTokens: FieldValue.increment(usage.inputTokens),
        openAiOutputTokens: FieldValue.increment(usage.outputTokens),
        openAiTotalTokens: FieldValue.increment(usage.totalTokens),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.create(
        db.collection(COLLECTIONS.transitions).doc(transitionId(job.id, "review_ready", job.attempt)),
        {
          entityId: job.calendarItemId,
          previousStatus: "generating",
          newStatus: "review_ready",
          actor: { uid: "seo-generation-worker", email: "" },
          timestamp: FieldValue.serverTimestamp(),
          articleId: draftId,
          versionId,
          safeReason: "Research, drafting, deterministic validation, editorial review and hero QA completed.",
          sourceAction: "generation_worker",
        },
      );
    });
    return {
      ok: true,
      processed: true,
      jobId: job.id,
      batchId: job.batchId,
      articleId: draftId,
      versionId,
      status: "review_ready",
      tokenUsage: usage,
      published: false,
    };
  } catch (error) {
    await failJob(db, job, error);
    return {
      ok: false,
      processed: true,
      jobId: job.id,
      batchId: job.batchId,
      status: "generation_failed",
      code: error?.code || "seo/batch-generation-failed",
      error: "The generation job failed. Other jobs in the batch can continue.",
      published: false,
    };
  }
}

export async function retrySeoGenerationJob(jobId, actor) {
  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.jobs).doc(String(jobId || ""));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Generation job not found.");
    if (snapshot.data()?.status === "queued") {
      return { ok: true, duplicatePrevented: true, jobId: snapshot.id };
    }
    if (snapshot.data()?.status !== "failed") {
      throw new Error("Only a failed generation job can be retried.");
    }
    transaction.update(ref, {
      status: "queued",
      retryRequestedBy: {
        uid: String(actor?.uid || ""),
        email: String(actor?.email || "").toLowerCase(),
      },
      safeError: FieldValue.delete(),
      errorCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection(COLLECTIONS.calendar).doc(snapshot.data().calendarItemId), {
      status: "research_ready",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, duplicatePrevented: false, jobId: snapshot.id };
  });
}
