import crypto from "node:crypto";
import { getAdminDb } from "@/lib/firebaseAdmin";
import runtimeConfig from "@/lib/seoArticles/runtimeConfig.cjs";

const COLLECTIONS = {
  drafts: "seoArticleDrafts",
  images: "seoArticleDraftImages",
  exports: "seoArticleExports",
  runs: "seoArticleRuns",
  metrics: "seoArticleMetrics",
  reviewPackages: "seoArticleReviewPackageState",
  versions: "seoArticleVersions",
  calendar: "seoContentCalendar",
  socialItems: "seoSocialDistributionItems",
};

export const SEO_ADMIN_RECENT_LIMIT = 30;
export const SEO_RECURRING_CRON_ENABLED = false;
const ASSET_TOKEN_TTL_MS = 60 * 60 * 1000;

function toIso(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function scoreFromChecks(report) {
  const checks = Object.values(report?.checks || {});
  if (!checks.length) return null;
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function versionNumber(draft, publicationExport) {
  return Math.max(
    1,
    Number(
      publicationExport?.version
      || publicationExport?.versionNumber
      || draft?.currentVersion
      || draft?.version
      || 1,
    ) || 1,
  );
}

function effectiveStatus(draft, publicationExport) {
  if (
    publicationExport?.status === "publication_ready"
    && publicationExport?.publication?.published !== true
  ) return "publication_ready";
  return draft?.status || "unknown";
}

function editorialRecord(draft) {
  const editorial = draft?.editorialReview || draft?.editorial || null;
  if (!editorial) return { score: null, recommendation: null, comments: [] };
  return {
    score: numeric(editorial.score),
    recommendation: editorial.recommendation || editorial.status || null,
    comments: Array.isArray(editorial.comments)
      ? editorial.comments.map(String)
      : editorial.comment
        ? [String(editorial.comment)]
        : [],
  };
}

function assetSecret() {
  const secret = String(process.env.SEO_REVIEW_TOKEN_SECRET || "").trim();
  if (!secret) throw new Error("SEO_REVIEW_TOKEN_SECRET is not configured.");
  return secret;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createSeoHeroAssetToken({
  articleId,
  variant,
  expiresAt = Date.now() + ASSET_TOKEN_TTL_MS,
}) {
  const encoded = base64Url(JSON.stringify({
    articleId: String(articleId),
    variant: String(variant),
    expiresAt,
  }));
  const signature = crypto
    .createHmac("sha256", assetSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySeoHeroAssetToken(token, {
  articleId,
  variant,
  now = Date.now(),
} = {}) {
  const [encoded, supplied, extra] = String(token || "").split(".");
  if (!encoded || !supplied || extra) throw new Error("Invalid hero asset token.");
  const expected = crypto
    .createHmac("sha256", assetSecret())
    .update(encoded)
    .digest("base64url");
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) throw new Error("Invalid hero asset token.");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid hero asset token.");
  }
  if (
    payload.articleId !== String(articleId)
    || payload.variant !== String(variant)
    || Number(payload.expiresAt) <= now
  ) throw new Error("Expired or mismatched hero asset token.");
  return payload;
}

function heroAssetUrl(articleId, variant) {
  const token = createSeoHeroAssetToken({ articleId, variant });
  return `/api/admin/seo-articles/${encodeURIComponent(articleId)}/hero/${variant}?token=${encodeURIComponent(token)}`;
}

function safeHero(image, articleId) {
  const passed = image?.qa?.passed === true
    && Boolean(image?.pngBase64)
    && Boolean(image?.mobilePngBase64);
  return {
    approved: passed,
    status: passed ? "qa_passed" : image?.imageReviewRequired ? "review_required" : "missing",
    title: image?.heroTitle || null,
    score: numeric(image?.qa?.visionScore),
    layout: image?.layoutVariant || image?.qa?.finalLayoutVariant || null,
    font: image?.qa?.attemptDiagnostics?.at?.(-1)?.resolvedFontFamily || null,
    width: numeric(image?.width),
    height: numeric(image?.height),
    mobileWidth: numeric(image?.mobileWidth),
    mobileHeight: numeric(image?.mobileHeight),
    urls: passed ? {
      master: heroAssetUrl(articleId, "master"),
      mobile: heroAssetUrl(articleId, "mobile"),
      svg: image?.svg ? heroAssetUrl(articleId, "svg") : null,
    } : { master: null, mobile: null, svg: null },
  };
}

function articleSummary({
  id,
  draft,
  image,
  publicationExport,
  run,
  reviewPackage,
}) {
  const article = publicationExport?.article || draft?.article || {};
  const version = versionNumber(draft, publicationExport);
  const editorial = editorialRecord(draft);
  const status = effectiveStatus(draft, publicationExport);
  return {
    id,
    previewAvailable: true,
    title: article.title || "Untitled article",
    heroTitle: image?.heroTitle || draft?.heroTitle || null,
    version,
    versionId: `v${version}`,
    primaryKeyword: article.keywords?.[0] || null,
    topic: draft?.generation?.topic || article.category || null,
    status,
    decisionStatus: draft?.status || "unknown",
    qualityScore: scoreFromChecks(draft?.qualityReport || publicationExport?.qualityReport),
    editorialScore: editorial.score,
    editorialRecommendation: editorial.recommendation,
    heroScore: numeric(image?.qa?.visionScore || draft?.imageQa?.visionScore),
    heroStatus: image?.qa?.passed === true ? "qa_passed" : "review_required",
    reviewEmailStatus: reviewPackage?.lastStatus || run?.emailStatus || "not_sent",
    generatedAt: toIso(draft?.createdAt),
    decisionAt: toIso(draft?.reviewedAt),
    approvalAt: draft?.status === "approved" ? toIso(draft?.reviewedAt) : null,
    publicationReady: publicationExport?.status === "publication_ready",
    published: publicationExport?.publication?.published === true
      || draft?.publication?.published === true,
    eligibleActions: draft?.status === "in_review"
      ? ["approve", "request_changes", "reject"]
      : [],
  };
}

function failedRunSummary(run) {
  return {
    id: `run-${run.id}`,
    previewAvailable: false,
    title: run.slug
      ? `Generation failed: ${String(run.slug).replaceAll("-", " ")}`
      : "Article generation failed",
    heroTitle: null,
    version: 1,
    versionId: "v1",
    primaryKeyword: null,
    topic: null,
    status: run.status || "failed",
    decisionStatus: run.status || "failed",
    qualityScore: scoreFromChecks(run.qualityReport),
    editorialScore: null,
    editorialRecommendation: null,
    heroScore: null,
    heroStatus: "missing",
    reviewEmailStatus: run.emailStatus || "not_sent",
    generatedAt: toIso(run.updatedAt || run.createdAt),
    decisionAt: null,
    approvalAt: null,
    publicationReady: false,
    published: false,
    eligibleActions: [],
    errorCode: run.errorCode || null,
  };
}

async function getStatusCounts(db) {
  const drafts = db.collection(COLLECTIONS.drafts);
  const exports = db.collection(COLLECTIONS.exports);
  const [
    awaitingReview,
    changesRequested,
    rejected,
    publicationReady,
  ] = await Promise.all([
    drafts.where("status", "in", ["email_pending", "in_review"]).count().get(),
    drafts.where("status", "==", "changes_requested").count().get(),
    drafts.where("status", "==", "rejected").count().get(),
    exports.where("status", "==", "publication_ready").count().get(),
  ]);
  return {
    awaitingReview: awaitingReview.data().count,
    changesRequested: changesRequested.data().count,
    publicationReady: publicationReady.data().count,
    rejected: rejected.data().count,
  };
}

function serializeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status || "unknown",
    attemptedAt: toIso(run.updatedAt || run.createdAt),
    draftId: run.draftId || null,
    errorCode: run.errorCode || null,
  };
}

function storedMetrics(data = {}) {
  const fields = [
    "draftsGenerated",
    "generationFailures",
    "reviewEmailsSent",
    "reviewEmailFailures",
    "approved",
    "changesRequested",
    "rejected",
    "averageArticleQuality",
    "averageEditorialScore",
    "averageHeroScore",
    "estimatedOpenAiCostToday",
    "estimatedOpenAiCostMonth",
  ];
  return Object.fromEntries(fields.map((field) => [field, numeric(data[field])]));
}

export async function getSeoAdminDashboard() {
  const db = getAdminDb();
  const config = runtimeConfig.getSeoArticleRuntimeConfig();
  const [draftSnapshot, runSnapshot, metricsSnapshot, counts] = await Promise.all([
    db.collection(COLLECTIONS.drafts)
      .orderBy("createdAt", "desc")
      .limit(SEO_ADMIN_RECENT_LIMIT)
      .get(),
    db.collection(COLLECTIONS.runs)
      .orderBy("updatedAt", "desc")
      .limit(SEO_ADMIN_RECENT_LIMIT)
      .get(),
    db.collection(COLLECTIONS.metrics).doc("aggregate").get(),
    getStatusCounts(db),
  ]);
  const drafts = draftSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  }));
  const runs = runSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  }));
  const [images, exports, reviewPackages] = drafts.length
    ? await Promise.all([
      db.getAll(...drafts.map((draft) => db.collection(COLLECTIONS.images).doc(draft.id))),
      db.getAll(...drafts.map((draft) => db.collection(COLLECTIONS.exports).doc(draft.id))),
      db.getAll(...drafts.map((draft) => db.collection(COLLECTIONS.reviewPackages).doc(draft.id))),
    ])
    : [[], [], []];
  const imageById = new Map(images.filter((item) => item.exists).map((item) => [item.id, item.data()]));
  const exportById = new Map(exports.filter((item) => item.exists).map((item) => [item.id, item.data()]));
  const reviewById = new Map(reviewPackages.filter((item) => item.exists).map((item) => [item.id, item.data()]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const draftArticles = drafts.map((draft) => articleSummary({
    id: draft.id,
    draft,
    image: exportById.get(draft.id)?.heroImage || imageById.get(draft.id),
    publicationExport: exportById.get(draft.id),
    run: runById.get(draft.runId),
    reviewPackage: reviewById.get(draft.id),
  }));
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const failedRuns = runs
    .filter((run) => (
      ["failed", "quality_failed"].includes(run.status)
      && (!run.draftId || !draftIds.has(run.draftId))
    ))
    .map(failedRunSummary);
  const articles = [...draftArticles, ...failedRuns]
    .sort((left, right) => (
      new Date(right.generatedAt || 0).getTime() - new Date(left.generatedAt || 0).getTime()
    ))
    .slice(0, SEO_ADMIN_RECENT_LIMIT);
  const successfulRun = runs.find((run) => ["email_sent", "completed"].includes(run.status));
  const failedRun = runs.find((run) => ["failed", "quality_failed"].includes(run.status));
  const current = draftArticles[0] || null;
  return {
    engine: {
      enabled: config.ok,
      recurringCronEnabled: SEO_RECURRING_CRON_ENABLED,
      missingConfiguration: config.missing,
      lastAttemptedRun: serializeRun(runs[0]),
      lastSuccessfulRun: serializeRun(successfulRun),
      lastFailedRun: serializeRun(failedRun),
      counts,
    },
    today: current ? {
      ...current,
      hero: safeHero(
        exportById.get(current.id)?.heroImage || imageById.get(current.id),
        current.id,
      ),
    } : null,
    articles,
    metrics: storedMetrics(metricsSnapshot.exists ? metricsSnapshot.data() : {}),
    integrations: {
      googleSearchConsole: { connected: false, label: "Google Search Console not connected" },
      keywordRankings: { connected: false, label: "Keyword rankings not connected" },
      backlinkMonitoring: { connected: false, label: "Backlink monitoring not connected" },
      organicTraffic: { connected: false, label: "Organic traffic data not connected" },
    },
    limits: {
      recentArticles: SEO_ADMIN_RECENT_LIMIT,
      recentRuns: SEO_ADMIN_RECENT_LIMIT,
      rawAnalyticsScanned: false,
    },
  };
}

function flattenWords(article) {
  const values = [];
  const walk = (value) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(article?.content || []);
  return values.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function internalLinkCount(article) {
  let count = 0;
  for (const block of article?.content || []) {
    for (const segment of block.segments || []) {
      if (String(segment?.href || "").startsWith("/")) count += 1;
    }
  }
  return count;
}

export async function getSeoAdminArticle(articleId) {
  const id = String(articleId || "").trim();
  if (!id) throw new Error("Article ID is required.");
  const db = getAdminDb();
  const [
    draftSnapshot,
    imageSnapshot,
    exportSnapshot,
    packageSnapshot,
    versionSnapshot,
    calendarSnapshot,
    socialSnapshot,
  ] = await Promise.all([
    db.collection(COLLECTIONS.drafts).doc(id).get(),
    db.collection(COLLECTIONS.images).doc(id).get(),
    db.collection(COLLECTIONS.exports).doc(id).get(),
    db.collection(COLLECTIONS.reviewPackages).doc(id).get(),
    db.collection(COLLECTIONS.versions).where("articleId", "==", id).limit(20).get(),
    db.collection(COLLECTIONS.calendar).where("articleId", "==", id).limit(1).get(),
    db.collection(COLLECTIONS.socialItems).where("articleId", "==", id).limit(100).get(),
  ]);
  if (!draftSnapshot.exists) {
    const error = new Error("Article not found.");
    error.code = "seo/article-not-found";
    throw error;
  }
  const draft = draftSnapshot.data();
  const publicationExport = exportSnapshot.exists ? exportSnapshot.data() : null;
  const image = publicationExport?.heroImage
    || (imageSnapshot.exists ? imageSnapshot.data() : null);
  const article = publicationExport?.article || draft.article;
  const version = versionNumber(draft, publicationExport);
  const editorial = editorialRecord(draft);
  const summary = articleSummary({
    id,
    draft,
    image,
    publicationExport,
    reviewPackage: packageSnapshot.exists ? packageSnapshot.data() : null,
  });
  return {
    summary,
    article,
    hero: safeHero(image, id),
    sources: publicationExport?.sources || draft.sources || [],
    claims: publicationExport?.claims || draft.claims || [],
    qualityReport: publicationExport?.qualityReport || draft.qualityReport || null,
    editorial,
    version: {
      number: version,
      id: `v${version}`,
      immutableSource: publicationExport ? "publication_ready_export" : "draft_snapshot",
    },
    versionHistory: versionSnapshot.empty ? [{
      id: `v${version}`,
      number: version,
      source: publicationExport ? "publication_ready_export" : "draft_snapshot",
      createdAt: toIso(publicationExport?.createdAt || draft.createdAt),
      immutable: Boolean(publicationExport),
    }] : versionSnapshot.docs
      .map((snapshot) => ({
        id: snapshot.data()?.versionId || snapshot.id,
        number: Number(String(snapshot.data()?.versionId || "v1").replace(/^v/, "")) || 1,
        source: "immutable_article_version",
        createdAt: toIso(snapshot.data()?.createdAt),
        immutable: snapshot.data()?.immutable === true,
      }))
      .sort((left, right) => right.number - left.number),
    schedule: calendarSnapshot.empty ? {
      calendarItemId: null,
      scheduledFor: publicationExport?.publication?.scheduledFor
        ? toIso(publicationExport.publication.scheduledFor)
        : null,
    } : {
      calendarItemId: calendarSnapshot.docs[0].id,
      scheduledFor: toIso(calendarSnapshot.docs[0].data()?.proposedPublicationDate),
    },
    bufferDistribution: {
      status: socialSnapshot.empty ? "not_generated" : "generated",
      itemCount: socialSnapshot.size,
      scheduledCount: socialSnapshot.docs.filter((item) => item.data()?.status === "buffer_scheduled").length,
      promotedCount: socialSnapshot.docs.filter((item) => item.data()?.status === "promoted").length,
      failedCount: socialSnapshot.docs.filter((item) => item.data()?.status === "failed").length,
    },
    publication: {
      status: effectiveStatus(draft, publicationExport),
      exportReady: publicationExport?.publication?.exportReady === true
        || draft?.publication?.exportReady === true,
      published: publicationExport?.publication?.published === true
        || draft?.publication?.published === true,
      exportedToLiveCollection: publicationExport?.publication?.exportedToLiveCollection === true,
    },
    reviewPackage: packageSnapshot.exists ? {
      lastStatus: packageSnapshot.data()?.lastStatus || null,
      lastRevision: packageSnapshot.data()?.lastRevision || null,
      lastSentAt: toIso(packageSnapshot.data()?.lastSentAt),
      providerMessageId: packageSnapshot.data()?.providerMessageId || null,
    } : null,
    metrics: {
      wordCount: flattenWords(article),
      sourceCount: (publicationExport?.sources || draft.sources || []).length,
      internalLinkCount: internalLinkCount(article),
      ctaDestination: article?.cta?.href || "/start",
      readingMinutes: article?.readingMinutes || null,
    },
  };
}

export async function readSeoHeroAsset(articleId, variant) {
  const id = String(articleId || "").trim();
  const db = getAdminDb();
  const [imageSnapshot, exportSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.images).doc(id).get(),
    db.collection(COLLECTIONS.exports).doc(id).get(),
  ]);
  const image = exportSnapshot.data()?.heroImage
    || (imageSnapshot.exists ? imageSnapshot.data() : null);
  if (image?.qa?.passed !== true) {
    const error = new Error("An approved hero asset is not available.");
    error.code = "seo/hero-not-approved";
    throw error;
  }
  if (variant === "master" && image.pngBase64) {
    return {
      body: Buffer.from(image.pngBase64, "base64"),
      contentType: "image/png",
      etag: `"${crypto.createHash("sha256").update(image.pngBase64).digest("hex")}"`,
    };
  }
  if (variant === "mobile" && image.mobilePngBase64) {
    return {
      body: Buffer.from(image.mobilePngBase64, "base64"),
      contentType: "image/png",
      etag: `"${crypto.createHash("sha256").update(image.mobilePngBase64).digest("hex")}"`,
    };
  }
  if (variant === "svg" && image.svg) {
    return {
      body: Buffer.from(image.svg),
      contentType: "image/svg+xml; charset=utf-8",
      etag: `"${crypto.createHash("sha256").update(image.svg).digest("hex")}"`,
    };
  }
  const error = new Error("Hero asset not found.");
  error.code = "seo/hero-not-found";
  throw error;
}
