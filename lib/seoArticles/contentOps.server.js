import crypto from "node:crypto";
import { BLOG_POSTS } from "@/app/blog/posts";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import contentPlan from "@/lib/seoArticles/contentPlan.cjs";
import pipeline from "@/lib/seoArticles/pipelineCore.cjs";
import bufferCore from "@/lib/integrations/bufferCore.cjs";
import {
  createSeoHeroAssetToken,
  getSeoAdminDashboard,
} from "@/lib/seoArticles/admin.server";

const {
  createAnnualContentPlan,
  findDuplicateRisks,
} = contentPlan;
const {
  DEFAULT_SETTINGS,
  PIPELINE_STATES,
  assignNextPublicationSlots,
  buildGenerationJobSpecs,
  reviewEligibility,
  selectGenerationBatch,
  transitionRecord,
  validateGenerationBatch,
  validateSettings,
} = pipeline;
const {
  bufferRuntimeConfig,
  queueCapacity,
  selectableChannels,
  validateChannelSelection,
} = bufferCore;

const COLLECTIONS = Object.freeze({
  settings: "seoContentSettings",
  plans: "seoContentPlans",
  calendar: "seoContentCalendar",
  transitions: "seoContentTransitions",
  batches: "seoGenerationBatches",
  jobs: "seoGenerationJobs",
  drafts: "seoArticleDrafts",
  images: "seoArticleDraftImages",
  exports: "seoArticleExports",
  versions: "seoArticleVersions",
  publicJournal: "seoPublishedJournal",
  metrics: "seoArticleMetrics",
  bufferConfig: "seoBufferConfiguration",
  socialItems: "seoSocialDistributionItems",
  bufferOperations: "seoBufferOperations",
  operations: "seoContentOperations",
});

const PLAN_ID = "rolling-2026-08";
const SETTINGS_ID = "default";
const BUFFER_CONFIG_ID = "default";
const CALENDAR_LIMIT = 156;
const REVIEW_LIMIT = 10;
const PIPELINE_LIMIT = 100;
const BUFFER_ITEM_LIMIT = 100;

function toIso(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snapshotData(snapshot) {
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

function serialize(value) {
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function safeActor(actor) {
  return {
    uid: String(actor?.uid || ""),
    email: String(actor?.email || "").trim().toLowerCase(),
  };
}

function pipelineStatus(value) {
  if (value === "in_review" || value === "email_pending" || value === "email_sent") {
    return "review_ready";
  }
  return PIPELINE_STATES.includes(value) ? value : "planned";
}

function auditId(record) {
  return crypto
    .createHash("sha256")
    .update([
      record.entityId,
      record.previousStatus,
      record.newStatus,
      record.sourceAction,
      record.timestamp,
    ].join(":"))
    .digest("hex");
}

function operationRef(db, action, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(key)) {
    throw new TypeError("A valid idempotency key is required.");
  }
  const id = crypto.createHash("sha256").update(`${action}:${key}`).digest("hex");
  return db.collection(COLLECTIONS.operations).doc(id);
}

function writeTransition(transaction, db, input) {
  const record = transitionRecord(input);
  transaction.create(
    db.collection(COLLECTIONS.transitions).doc(auditId(record)),
    { ...record, timestamp: new Date(record.timestamp) },
  );
  return record;
}

async function readSettings(db, { required = false } = {}) {
  const snapshot = await db.collection(COLLECTIONS.settings).doc(SETTINGS_ID).get();
  const saved = snapshot.data() || {};
  if (required && (!snapshot.exists || !Number.isInteger(saved.batchSize))) {
    const error = new Error("SEO generation settings, including batch size, have not been saved.");
    error.code = "seo/settings-missing";
    throw error;
  }
  return snapshot.exists ? validateSettings(saved) : validateSettings(DEFAULT_SETTINGS);
}

async function readCalendar(db) {
  const snapshot = await db.collection(COLLECTIONS.calendar)
    .orderBy("proposedPublicationDate", "asc")
    .limit(CALENDAR_LIMIT)
    .get();
  return snapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() }));
}

function qualityScore(report) {
  const checks = Object.values(report?.checks || {});
  return checks.length ? Math.round((checks.filter(Boolean).length / checks.length) * 100) : null;
}

function wordCount(article) {
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(article?.content || []);
  return strings.join(" ").split(/\s+/).filter(Boolean).length;
}

async function readReviewQueue(db, settings) {
  const draftSnapshot = await db.collection(COLLECTIONS.drafts)
    .where("status", "in", ["review_ready", "in_review", "changes_requested"])
    .orderBy("createdAt", "desc")
    .limit(REVIEW_LIMIT)
    .get();
  const drafts = draftSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (!drafts.length) return [];
  const [images, calendar] = await Promise.all([
    db.getAll(...drafts.map((draft) => db.collection(COLLECTIONS.images).doc(draft.id))),
    readCalendar(db),
  ]);
  const imageById = new Map(images.filter((item) => item.exists).map((item) => [item.id, item.data()]));
  const calendarByArticle = new Map(calendar.filter((item) => item.articleId).map((item) => [item.articleId, item]));
  return drafts.map((draft) => {
    const image = imageById.get(draft.id);
    const checks = draft.qualityReport?.checks || {};
    const editorial = draft.editorialReview || {};
    const item = {
      id: draft.id,
      articleId: draft.id,
      versionId: `v${Number(draft.currentVersion || draft.version || 1)}`,
      title: draft.article?.title || "Untitled article",
      primaryKeyword: draft.article?.keywords?.[0] || null,
      category: draft.article?.category || null,
      calendarItemId: calendarByArticle.get(draft.id)?.calendarItemId || null,
      plannedDate: calendarByArticle.get(draft.id)?.proposedPublicationDate || null,
      qualityScore: qualityScore(draft.qualityReport),
      qualityReport: { checks },
      editorial: {
        recommendation: editorial.recommendation || null,
        comments: editorial.comments || [],
      },
      editorialScore: Number.isFinite(Number(editorial.score)) ? Number(editorial.score) : null,
      hero: {
        approved: image?.qa?.passed === true,
        score: Number(image?.qa?.visionScore || draft.imageQa?.visionScore || 0),
        thumbnailUrl: image?.qa?.passed === true
          ? `/api/admin/seo-articles/${encodeURIComponent(draft.id)}/hero/mobile?token=${encodeURIComponent(createSeoHeroAssetToken({
            articleId: draft.id,
            variant: "mobile",
          }))}`
          : null,
      },
      heroScore: Number(image?.qa?.visionScore || draft.imageQa?.visionScore || 0),
      sourceCount: (draft.sources || []).length,
      sources: draft.sources || [],
      wordCount: wordCount(draft.article),
      readingMinutes: draft.article?.readingMinutes || null,
      currentStatus: draft.status,
      duplicateRisk: draft.duplicateRisk || { passed: true },
    };
    return { ...item, eligibility: reviewEligibility(item, settings) };
  });
}

function groupPipeline(calendar, reviewQueue) {
  const articles = new Map(reviewQueue.map((article) => [article.articleId, article]));
  return PIPELINE_STATES.map((status) => ({
    status,
    items: calendar
      .filter((item) => item.status === status)
      .slice(0, 20)
      .map((item) => ({
        calendarItemId: item.calendarItemId,
        articleId: item.articleId || null,
        title: articles.get(item.articleId)?.title || item.provisionalTitle,
        publicationDate: item.proposedPublicationDate,
        primaryKeyword: item.primaryKeyword,
      })),
  })).filter((column) => column.items.length || [
    "planned",
    "generating",
    "review_ready",
    "approved",
    "scheduled",
    "published",
  ].includes(column.status));
}

function calendarCapacity(calendar) {
  return {
    planned: calendar.length,
    generated: calendar.filter((item) => item.articleId).length,
    awaitingReview: calendar.filter((item) => ["review_ready", "in_review"].includes(item.status)).length,
    scheduled: calendar.filter((item) => item.status === "scheduled").length,
    published: calendar.filter((item) => item.status === "published").length,
    empty: calendar.filter((item) => !item.articleId).length,
  };
}

export async function getSeoOperationsArea(area) {
  const db = getAdminDb();
  const settings = await readSettings(db);
  if (area === "overview") {
    const [dashboard, metricsSnapshot] = await Promise.all([
      getSeoAdminDashboard(),
      db.collection(COLLECTIONS.metrics).doc("aggregate").get(),
    ]);
    return {
      area,
      settings,
      dashboard,
      operationalAggregates: serialize(metricsSnapshot.data() || {}),
    };
  }
  if (area === "calendar") {
    const [calendar, transitionSnapshot] = await Promise.all([
      readCalendar(db),
      db.collection(COLLECTIONS.transitions)
        .orderBy("timestamp", "desc")
        .limit(PIPELINE_LIMIT)
        .get(),
    ]);
    const reviewQueue = await readReviewQueue(db, settings);
    return {
      area,
      settings,
      calendar,
      capacity: calendarCapacity(calendar),
      pipeline: groupPipeline(calendar, reviewQueue),
      recentTransitions: transitionSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
    };
  }
  if (area === "generate") {
    const savedSettings = await readSettings(db, { required: true });
    const [calendar, draftSnapshot, publicSnapshot, batchSnapshot, jobSnapshot] = await Promise.all([
      readCalendar(db),
      db.collection(COLLECTIONS.drafts).orderBy("createdAt", "desc").limit(100).get(),
      db.collection(COLLECTIONS.publicJournal)
        .where("published", "==", true)
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.batches).orderBy("createdAt", "desc").limit(20).get(),
      db.collection(COLLECTIONS.jobs).orderBy("createdAt", "desc").limit(100).get(),
    ]);
    const existing = [
      ...BLOG_POSTS.map((article) => ({
        id: `static:${article.slug}`,
        title: article.title,
        keywords: article.keywords,
        searchIntent: article.title,
      })),
      ...draftSnapshot.docs.map((doc) => ({
        id: doc.id,
        title: doc.data().article?.title,
        keywords: doc.data().article?.keywords,
        searchIntent: doc.data().generation?.searchIntent,
      })),
      ...publicSnapshot.docs.map((doc) => ({
        id: `published:${doc.id}`,
        title: doc.data().article?.title,
        keywords: doc.data().article?.keywords,
        searchIntent: doc.data().article?.title,
      })),
    ];
    const preview = selectGenerationBatch(calendar, {
      batchSize: savedSettings.batchSize,
      existingArticles: existing,
      duplicateCheck: findDuplicateRisks,
      maxTitleLength: savedSettings.maxProvisionalTitleLength,
    });
    return {
      area,
      settings: savedSettings,
      preview: {
        ...preview,
        estimatedOpenAi: {
          lowerTokens: preview.selected.length * 10_000,
          upperTokens: preview.selected.length * 30_000,
          monetaryCost: null,
          note: "A monetary estimate requires stored model pricing. Exact usage is recorded after each Responses API call.",
        },
      },
      batches: batchSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
      jobs: jobSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
    };
  }
  if (area === "review") {
    const [queue, calendar] = await Promise.all([
      readReviewQueue(db, settings),
      readCalendar(db),
    ]);
    const eligible = queue.filter((item) => item.eligibility.eligible);
    const eligibleIds = new Set(eligible.map((item) => item.articleId));
    const schedulableCalendar = calendar.map((item) => (
      eligibleIds.has(item.articleId)
        ? { ...item, articleId: null, versionId: null, status: "planned" }
        : item
    ));
    return {
      area,
      settings,
      queue,
      schedulingPreview: assignNextPublicationSlots(eligible, schedulableCalendar, {
        limit: Math.min(10, eligible.length),
      }),
    };
  }
  if (area === "publishing") {
    const exportSnapshot = await db.collection(COLLECTIONS.exports)
      .orderBy("updatedAt", "desc")
      .limit(30)
      .get();
    const exports = exportSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const draftSnapshots = exports.length
      ? await db.getAll(...exports.map((item) => db.collection(COLLECTIONS.drafts).doc(item.id)))
      : [];
    const draftById = new Map(draftSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]));
    return {
      area,
      settings,
      items: exports.map((item) => serialize({
        articleId: item.id,
        calendarItemId: draftById.get(item.id)?.calendarItemId || null,
        versionId: `v${Number(item.version || item.versionNumber || draftById.get(item.id)?.version || 1)}`,
        title: item.article?.title,
        slug: item.article?.slug,
        status: item.status,
        approvedAt: draftById.get(item.id)?.reviewedAt || null,
        scheduledFor: item.publication?.scheduledFor || null,
        published: item.publication?.published === true,
        publishedAt: item.publication?.publishedAt || null,
        liveUrl: item.publication?.liveUrl || null,
        heroPassed: item.heroImage?.qa?.passed === true,
        sourceCount: (item.sources || []).length,
      })),
    };
  }
  if (area === "distribution") {
    const [configSnapshot, socialSnapshot, operationSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.bufferConfig).doc(BUFFER_CONFIG_ID).get(),
      db.collection(COLLECTIONS.socialItems)
        .orderBy("generatedAt", "desc")
        .limit(BUFFER_ITEM_LIMIT)
        .get(),
      db.collection(COLLECTIONS.bufferOperations)
        .orderBy("updatedAt", "desc")
        .limit(30)
        .get(),
    ]);
    const config = serialize(configSnapshot.data() || {});
    const socialItems = socialSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() }));
    return {
      area,
      settings,
      connection: {
        configured: Boolean(bufferRuntimeConfig().apiKey),
        syncEnabled: bufferRuntimeConfig().syncEnabled && config.enabled === true,
        organisationId: config.organisationId || null,
        channels: config.channels || [],
        lastCheckedAt: config.lastCheckedAt || null,
        lastSuccessfulSyncAt: config.lastSuccessfulSyncAt || null,
        rateLimit: config.rateLimit || { limited: false },
      },
      socialItems,
      operations: operationSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
      queue: queueCapacity({
        scheduledCount: socialItems.filter((item) => item.status === "buffer_scheduled").length,
        requestedCount: 0,
        maximum: Number(config.queueMaximum || 100),
      }),
    };
  }
  if (area === "performance") {
    const snapshot = await db.collection(COLLECTIONS.metrics).doc("aggregate").get();
    return {
      area,
      settings,
      metrics: serialize(snapshot.data() || {}),
      external: {
        searchConsole: { connected: false, label: "Google Search Console not connected" },
        organicTraffic: { connected: false, label: "GA4 Data API not connected" },
        keywordRankings: { connected: false, label: "Rankings will initially use Search Console" },
        backlinks: { connected: false, label: "Backlink monitoring not connected" },
      },
    };
  }
  if (area === "settings") {
    const configSnapshot = await db.collection(COLLECTIONS.bufferConfig).doc(BUFFER_CONFIG_ID).get();
    return {
      area,
      settings,
      buffer: {
        apiKeyConfigured: Boolean(bufferRuntimeConfig().apiKey),
        environmentSyncEnabled: bufferRuntimeConfig().syncEnabled,
        configuration: serialize(configSnapshot.data() || {}),
      },
    };
  }
  throw new Error("Unknown SEO operations area.");
}

async function initialisePlan(db, actor, input) {
  const settings = await readSettings(db);
  const plan = createAnnualContentPlan({
    startDate: input.startDate || settings.annualPlanStartDate,
    weekdays: settings.publicationWeekdays,
    publicationTime: settings.publicationTime,
    timezone: settings.timezone,
    createdAt: new Date().toISOString(),
  });
  const planRef = db.collection(COLLECTIONS.plans).doc(PLAN_ID);
  const result = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(planRef);
    if (current.exists) return { created: false, plan: current.data() };
    const { items, ...planRecord } = plan;
    transaction.create(planRef, {
      ...planRecord,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: safeActor(actor),
    });
    for (const item of plan.items) {
      transaction.create(db.collection(COLLECTIONS.calendar).doc(item.calendarItemId), {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      });
    }
    transaction.set(db.collection(COLLECTIONS.metrics).doc("aggregate"), {
      plannedArticles: plan.slotCount,
      emptySlots: plan.slotCount,
      publicationCapacity: plan.slotCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { created: true, plan };
  });
  return { ok: true, duplicatePrevented: !result.created, planId: PLAN_ID, slotCount: 156 };
}

async function rescheduleCalendarItem(db, actor, input) {
  const id = String(input.calendarItemId || "");
  const target = String(input.proposedPublicationDate || "");
  if (!id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(target)) {
    throw new TypeError("Choose a calendar item and a Europe/London publication date.");
  }
  const itemRef = db.collection(COLLECTIONS.calendar).doc(id);
  const result = await db.runTransaction(async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef);
    if (!itemSnapshot.exists) throw new Error("Calendar item not found.");
    const item = itemSnapshot.data();
    if (item.proposedPublicationDate === target) return { duplicatePrevented: true };
    const occupied = await transaction.get(
      db.collection(COLLECTIONS.calendar)
        .where("proposedPublicationDate", "==", target)
        .limit(1),
    );
    if (!occupied.empty) throw new Error("That publication slot is already occupied.");
    const targetDate = new Date(`${target.slice(0, 10)}T12:00:00Z`);
    const day = targetDate.getUTCDay() || 7;
    targetDate.setUTCDate(targetDate.getUTCDate() - day + 1);
    const weekStart = targetDate.toISOString().slice(0, 10);
    const weekEndDate = new Date(targetDate);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);
    const week = await transaction.get(
      db.collection(COLLECTIONS.calendar)
        .where("proposedPublicationDate", ">=", `${weekStart}T00:00:00`)
        .where("proposedPublicationDate", "<", `${weekEnd}T00:00:00`)
        .limit(4),
    );
    const otherCount = week.docs.filter((doc) => doc.id !== id).length;
    if (otherCount >= 3) throw new Error("That week already has three publication slots.");
    transaction.update(itemRef, {
      proposedPublicationDate: target,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeTransition(transaction, db, {
      entityId: id,
      previousStatus: item.status,
      newStatus: pipelineStatus(item.status),
      actor,
      articleId: item.articleId,
      versionId: item.versionId,
      safeReason: "Publication slot rescheduled.",
      sourceAction: "admin_reschedule",
    });
    return { duplicatePrevented: false };
  });
  return { ok: true, calendarItemId: id, ...result };
}

async function swapCalendarSlots(db, actor, input) {
  const firstId = String(input.firstCalendarItemId || "");
  const secondId = String(input.secondCalendarItemId || "");
  if (!firstId || !secondId || firstId === secondId) {
    throw new TypeError("Choose two different calendar slots.");
  }
  const firstRef = db.collection(COLLECTIONS.calendar).doc(firstId);
  const secondRef = db.collection(COLLECTIONS.calendar).doc(secondId);
  const actionRef = operationRef(db, "swap_slots", input.idempotencyKey);
  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, firstSnapshot, secondSnapshot] = await Promise.all([
      transaction.get(actionRef),
      transaction.get(firstRef),
      transaction.get(secondRef),
    ]);
    if (operationSnapshot.data()?.status === "completed") {
      return { ...operationSnapshot.data().result, duplicatePrevented: true };
    }
    if (!firstSnapshot.exists || !secondSnapshot.exists) {
      throw new Error("One of the calendar slots no longer exists.");
    }
    const first = firstSnapshot.data();
    const second = secondSnapshot.data();
    transaction.update(firstRef, {
      proposedPublicationDate: second.proposedPublicationDate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(secondRef, {
      proposedPublicationDate: first.proposedPublicationDate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const [item, destination] of [[first, second], [second, first]]) {
      writeTransition(transaction, db, {
        entityId: item.calendarItemId,
        previousStatus: pipelineStatus(item.status),
        newStatus: pipelineStatus(item.status),
        actor,
        articleId: item.articleId,
        versionId: item.versionId,
        safeReason: `Publication slot swapped to ${destination.proposedPublicationDate}.`,
        sourceAction: "admin_drag_reschedule",
      });
    }
    const result = {
      ok: true,
      firstCalendarItemId: firstId,
      secondCalendarItemId: secondId,
      duplicatePrevented: false,
    };
    transaction.create(actionRef, {
      action: "swap_slots",
      status: "completed",
      result,
      actor: safeActor(actor),
      completedAt: FieldValue.serverTimestamp(),
    });
    return result;
  });
}

async function updateCalendarBrief(db, actor, input) {
  const id = String(input.calendarItemId || "");
  const provisionalTitle = String(input.provisionalTitle || "").trim();
  const primaryKeyword = String(input.primaryKeyword || "").trim();
  if (!id || provisionalTitle.length < 10 || primaryKeyword.length < 3) {
    throw new TypeError("Provide a calendar item, provisional title and primary keyword.");
  }
  const ref = db.collection(COLLECTIONS.calendar).doc(id);
  const initialSnapshot = await ref.get();
  if (!initialSnapshot.exists) throw new Error("Calendar item not found.");
  const initial = initialSnapshot.data();
  if (!["planned", "research_ready", "generation_failed"].includes(initial.status)) {
    throw new Error("A generated article brief cannot be replaced from the planning queue.");
  }
  const candidate = {
    ...initial,
    provisionalTitle,
    primaryKeyword,
    category: String(input.category || initial.category || "").trim(),
    searchIntent: String(input.searchIntent || initial.searchIntent || "").trim(),
    articleType: String(input.articleType || initial.articleType || "").trim(),
    evergreenOrAdaptive: String(
      input.evergreenOrAdaptive || initial.evergreenOrAdaptive || "",
    ).trim(),
    proposedPublicationDate: String(
      input.proposedPublicationDate || initial.proposedPublicationDate || "",
    ).trim(),
    rationale: String(input.rationale || initial.rationale || "").trim(),
  };
  if (
    !Object.hasOwn(DEFAULT_SETTINGS.categoryTargets, candidate.category)
    || !candidate.searchIntent
    || !["seasonal", "evergreen", "adaptive"].includes(candidate.evergreenOrAdaptive)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(candidate.proposedPublicationDate)
  ) {
    throw new TypeError("Provide a valid category, search intent, seasonality and planned date.");
  }
  const [draftSnapshot, publicSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.drafts).orderBy("createdAt", "desc").limit(500).get(),
    db.collection(COLLECTIONS.publicJournal).where("published", "==", true).limit(500).get(),
  ]);
  const existingArticles = [
    ...BLOG_POSTS,
    ...draftSnapshot.docs.map((doc) => ({
      id: doc.id,
      title: doc.data().article?.title,
      keywords: doc.data().article?.keywords,
      searchIntent: doc.data().generation?.searchIntent,
    })),
    ...publicSnapshot.docs.map((doc) => ({
      id: `published:${doc.id}`,
      title: doc.data().article?.title,
      keywords: doc.data().article?.keywords,
      searchIntent: doc.data().article?.title,
    })),
  ];
  const semanticRisk = findDuplicateRisks(candidate, existingArticles);
  if (!semanticRisk.passed) {
    const error = new Error("The replacement topic overlaps an existing Journal article.");
    error.code = "seo/duplicate-content-risk";
    error.blocked = [semanticRisk];
    throw error;
  }
  const result = await db.runTransaction(async (transaction) => {
    const [snapshot, calendarSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(
        db.collection(COLLECTIONS.calendar)
          .limit(CALENDAR_LIMIT),
      ),
    ]);
    if (!snapshot.exists) throw new Error("Calendar item not found.");
    const item = snapshot.data();
    if (!["planned", "research_ready", "generation_failed"].includes(item.status)) {
      throw new Error("A generated article brief cannot be replaced from the planning queue.");
    }
    if (calendarSnapshot.docs.some((doc) => (
      doc.id !== id
      && String(doc.data().primaryKeyword || "").trim().toLowerCase()
        === primaryKeyword.toLowerCase()
    ))) {
      const error = new Error("That primary keyword already belongs to another calendar item.");
      error.code = "seo/duplicate-primary-keyword";
      throw error;
    }
    if (
      candidate.proposedPublicationDate !== item.proposedPublicationDate
      && calendarSnapshot.docs.some((doc) => (
        doc.id !== id
        && doc.data().proposedPublicationDate === candidate.proposedPublicationDate
      ))
    ) {
      throw new Error("That publication slot is already occupied.");
    }
    if (
      item.provisionalTitle === provisionalTitle
      && item.primaryKeyword === primaryKeyword
      && item.category === candidate.category
      && item.searchIntent === candidate.searchIntent
      && item.articleType === candidate.articleType
      && item.evergreenOrAdaptive === candidate.evergreenOrAdaptive
      && item.proposedPublicationDate === candidate.proposedPublicationDate
    ) {
      return { duplicatePrevented: true };
    }
    transaction.update(ref, {
      provisionalTitle,
      primaryKeyword,
      secondaryKeywords: Array.isArray(input.secondaryKeywords)
        ? input.secondaryKeywords.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
        : item.secondaryKeywords || [],
      category: candidate.category,
      searchIntent: candidate.searchIntent,
      articleType: candidate.articleType,
      evergreenOrAdaptive: candidate.evergreenOrAdaptive,
      proposedPublicationDate: candidate.proposedPublicationDate,
      rationale: candidate.rationale,
      adaptiveEvidence: item.evergreenOrAdaptive === "adaptive"
        ? String(input.adaptiveEvidence || "").trim()
        : item.adaptiveEvidence || null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeTransition(transaction, db, {
      entityId: id,
      previousStatus: pipelineStatus(item.status),
      newStatus: pipelineStatus(item.status),
      actor,
      articleId: item.articleId,
      versionId: item.versionId,
      safeReason: input.replace === true
        ? "Administrator replaced the planned topic before generation."
        : "Administrator edited the planned article brief before generation.",
      sourceAction: input.replace === true ? "replace_topic" : "edit_brief",
    });
    return { duplicatePrevented: false };
  });
  return {
    ok: true,
    calendarItemId: id,
    semanticCannibalisation: {
      passed: semanticRisk.passed,
      staticArticlesChecked: BLOG_POSTS.length,
      firestoreArticlesChecked: draftSnapshot.size + publicSnapshot.size,
    },
    ...result,
  };
}

async function saveSettings(db, actor, input) {
  const settings = validateSettings(input.settings || {});
  const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_ID);
  await db.runTransaction(async (transaction) => {
    transaction.set(ref, {
      ...settings,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: safeActor(actor),
    }, { merge: true });
  });
  return {
    ok: true,
    settings: serialize(settings),
    automation: {
      generationEnabled: settings.generationEnabled,
      publicationAutomationEnabled: settings.publicationAutomationEnabled,
      bufferSyncEnabled: settings.bufferSyncEnabled,
    },
  };
}

async function createGenerationBatch(db, actor, input) {
  const settings = await readSettings(db, { required: true });
  if (!settings.generationEnabled) {
    const error = new Error("Content generation is disabled in SEO settings.");
    error.code = "seo/generation-disabled";
    throw error;
  }
  const actionRef = operationRef(db, "create_generation_batch", input.idempotencyKey);
  const previousOperation = await actionRef.get();
  if (previousOperation.data()?.status === "completed") {
    return { ...previousOperation.data().result, duplicatePrevented: true };
  }
  const calendar = await readCalendar(db);
  const [draftSnapshot, publicSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.drafts).orderBy("createdAt", "desc").limit(100).get(),
    db.collection(COLLECTIONS.publicJournal).where("published", "==", true).limit(100).get(),
  ]);
  const existingArticles = [
    ...BLOG_POSTS,
    ...draftSnapshot.docs.map((doc) => doc.data().article || {}),
    ...publicSnapshot.docs.map((doc) => doc.data().article || {}),
  ];
  if (input.confirmed !== true) {
    const error = new Error("Confirm the reviewed batch preview before creating generation jobs.");
    error.code = "seo/batch-confirmation-required";
    throw error;
  }
  const requestedIds = [...new Set((input.calendarItemIds || []).map(String).filter(Boolean))];
  const confirmedCount = Number(input.confirmedCount);
  if (
    !Number.isInteger(confirmedCount)
    || confirmedCount < 1
    || confirmedCount !== requestedIds.length
  ) {
    const error = new Error("The confirmed article count does not match the selected preview.");
    error.code = "seo/batch-count-mismatch";
    throw error;
  }
  if (confirmedCount > settings.batchSize) {
    const error = new Error(`The saved batch size allows at most ${settings.batchSize} articles.`);
    error.code = "seo/batch-size-exceeded";
    throw error;
  }
  const calendarById = new Map(calendar.map((item) => [item.calendarItemId, item]));
  const selected = requestedIds.map((id) => calendarById.get(id)).filter(Boolean);
  if (selected.length !== requestedIds.length) {
    throw new Error("One or more selected calendar slots could not be loaded.");
  }
  if (selected.some((item) => (
    !["planned", "research_ready", "generation_failed"].includes(item.status)
  ))) {
    throw new Error("One or more selected calendar slots are no longer eligible.");
  }
  const validation = validateGenerationBatch(selected, {
    existingArticles,
    duplicateCheck: findDuplicateRisks,
    maxTitleLength: settings.maxProvisionalTitleLength,
  });
  if (!validation.passed) {
    const error = new Error("The batch preview contains duplicate, overlapping or incomplete topics.");
    error.code = "seo/batch-topic-validation-failed";
    error.blocked = validation.issues;
    throw error;
  }
  const batchId = crypto.randomUUID();
  const batchRef = db.collection(COLLECTIONS.batches).doc(batchId);
  const jobSpecs = buildGenerationJobSpecs(batchId, selected);
  const result = await db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(actionRef);
    if (operationSnapshot.data()?.status === "completed") {
      return { ...operationSnapshot.data().result, duplicatePrevented: true };
    }
    const freshItems = [];
    for (const item of selected) {
      const ref = db.collection(COLLECTIONS.calendar).doc(item.calendarItemId);
      const fresh = await transaction.get(ref);
      freshItems.push(fresh);
    }
    for (const fresh of freshItems) {
      if (!["planned", "research_ready", "generation_failed"].includes(fresh.data()?.status)) {
        throw new Error("A selected calendar item is no longer eligible.");
      }
    }
    transaction.create(batchRef, {
      batchId,
      status: "queued",
      total: selected.length,
      completed: 0,
      failed: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      estimatedCost: null,
      createdBy: safeActor(actor),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const job of jobSpecs) {
      const item = job.brief;
      transaction.create(db.collection(COLLECTIONS.jobs).doc(job.jobId), {
        ...job,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(db.collection(COLLECTIONS.calendar).doc(item.calendarItemId), {
        status: "research_ready",
        generationBatchId: batchId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeTransition(transaction, db, {
        entityId: item.calendarItemId,
        previousStatus: item.status,
        newStatus: "research_ready",
        actor,
        safeReason: "Selected for an administrator-confirmed generation batch.",
        sourceAction: "generate_batch",
      });
    }
    const operationResult = {
      ok: true,
      batchId,
      queued: selected.length,
      browserWaitRequired: false,
      duplicatePrevented: false,
    };
    transaction.create(actionRef, {
      action: "create_generation_batch",
      status: "completed",
      result: operationResult,
      actor: safeActor(actor),
      completedAt: FieldValue.serverTimestamp(),
    });
    return operationResult;
  });
  return result;
}

async function reviewBulkAction(db, actor, input) {
  const action = String(input.reviewAction || "");
  if (!["approve", "request_changes", "replace_article", "reject", "approve_and_schedule"].includes(action)) {
    throw new TypeError("Choose a valid bulk review action.");
  }
  const ids = [...new Set((input.articleIds || []).map(String))].slice(0, 10);
  if (!ids.length) throw new Error("Select at least one article.");
  const actionRef = operationRef(
    db,
    `bulk_review:${action}:${ids.slice().sort().join(",")}`,
    input.idempotencyKey,
  );
  const previousOperation = await actionRef.get();
  if (previousOperation.data()?.status === "completed") {
    return { ...previousOperation.data().result, duplicatePrevented: true };
  }
  const settings = await readSettings(db);
  const queue = await readReviewQueue(db, settings);
  const selected = queue.filter((item) => ids.includes(item.articleId));
  if (selected.length !== ids.length) {
    throw new Error("One or more selected articles are no longer in the review queue.");
  }
  if (["approve", "approve_and_schedule"].includes(action)) {
    const blocked = selected.filter((item) => !item.eligibility.eligible);
    if (blocked.length) {
      const error = new Error("Bulk approval cannot ignore critical quality, source, hero or duplicate warnings.");
      error.code = "seo/bulk-review-blocked";
      error.blocked = blocked.map((item) => ({
        articleId: item.articleId,
        reasons: item.eligibility.reasons,
      }));
      throw error;
    }
  }
  const calendar = await readCalendar(db);
  const selectedIds = new Set(selected.map((article) => article.articleId));
  const schedulableCalendar = calendar.map((item) => (
    selectedIds.has(item.articleId)
      ? { ...item, articleId: null, versionId: null, status: "planned" }
      : item
  ));
  const assignments = action === "approve_and_schedule"
    ? assignNextPublicationSlots(selected, schedulableCalendar, { limit: selected.length })
    : [];
  const transactionResult = await db.runTransaction(async (transaction) => {
    const operationSnapshot = await transaction.get(actionRef);
    if (operationSnapshot.data()?.status === "completed") {
      return { ...operationSnapshot.data().result, duplicatePrevented: true };
    }
    const records = new Map();
    const calendarUpdates = new Map();
    if (action === "approve_and_schedule") {
      for (const article of selected) {
        if (article.calendarItemId) {
          calendarUpdates.set(article.calendarItemId, {
            articleId: FieldValue.delete(),
            versionId: FieldValue.delete(),
            status: "planned",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      for (const assignment of assignments) {
        calendarUpdates.set(assignment.calendarItemId, {
          articleId: assignment.articleId,
          versionId: assignment.versionId,
          status: "scheduled",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      const targetStatus = ["request_changes", "replace_article"].includes(action)
        ? "changes_requested"
        : action === "reject"
          ? "rejected"
          : "approved";
      for (const article of selected) {
        if (article.calendarItemId) {
          calendarUpdates.set(article.calendarItemId, {
            articleId: article.articleId,
            versionId: article.versionId,
            status: targetStatus,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
    for (const article of selected) {
      const draftRef = db.collection(COLLECTIONS.drafts).doc(article.articleId);
      const imageRef = db.collection(COLLECTIONS.images).doc(article.articleId);
      const exportRef = db.collection(COLLECTIONS.exports).doc(article.articleId);
      const [draftSnapshot, imageSnapshot, exportSnapshot] = await Promise.all([
        transaction.get(draftRef),
        transaction.get(imageRef),
        transaction.get(exportRef),
      ]);
      if (!["review_ready", "in_review", "changes_requested"].includes(draftSnapshot.data()?.status)) {
        throw new Error("An article is no longer eligible for this review action.");
      }
      records.set(article.articleId, {
        draftRef,
        imageRef,
        exportRef,
        draftSnapshot,
        imageSnapshot,
        exportSnapshot,
      });
    }
    for (const article of selected) {
      const record = records.get(article.articleId);
      const { draftRef, exportRef, draftSnapshot, imageSnapshot, exportSnapshot } = record;
      const draft = draftSnapshot.data();
      const assignment = assignments.find((item) => item.articleId === article.articleId);
      const previousStatus = pipelineStatus(article.currentStatus);
      const newStatus = ["request_changes", "replace_article"].includes(action)
        ? "changes_requested"
        : action === "reject"
          ? "rejected"
          : action === "approve_and_schedule"
            ? "scheduled"
            : "approved";
      if (["approve", "approve_and_schedule"].includes(action)) {
        transaction.set(exportRef, {
          schemaVersion: "journal-publication-export-v1",
          draftId: article.articleId,
          version: Number(draft.currentVersion || draft.version || 1),
          status: "publication_ready",
          article: draft.article,
          claims: draft.claims || [],
          sources: draft.sources || [],
          qualityReport: draft.qualityReport,
          editorialReview: draft.editorialReview || null,
          heroImage: imageSnapshot.data(),
          publication: {
            exportReady: true,
            published: false,
            exportedToLiveCollection: false,
            ...(action === "approve_and_schedule"
              ? { scheduledFor: assignments.find((item) => item.articleId === article.articleId)?.scheduledFor }
              : {}),
          },
          createdAt: exportSnapshot.exists
            ? exportSnapshot.data()?.createdAt || FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(draftRef, {
        status: newStatus,
        ...(assignment ? { calendarItemId: assignment.calendarItemId } : {}),
        ...(action === "replace_article" ? { replacementRequested: true } : {}),
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: safeActor(actor),
        publication: {
          exportReady: ["approve", "approve_and_schedule"].includes(action),
          published: false,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (action === "approve_and_schedule") {
        writeTransition(transaction, db, {
          entityId: article.articleId,
          previousStatus,
          newStatus: "approved",
          actor,
          articleId: article.articleId,
          versionId: article.versionId,
          safeReason: String(input.reason || "Administrator bulk approval."),
          sourceAction: "bulk_approve",
        });
        writeTransition(transaction, db, {
          entityId: `${article.articleId}-schedule`,
          previousStatus: "approved",
          newStatus: "scheduled",
          actor,
          articleId: article.articleId,
          versionId: article.versionId,
          safeReason: "Assigned to an explicitly previewed publication slot.",
          sourceAction: "bulk_approve_and_schedule",
        });
      } else {
        writeTransition(transaction, db, {
          entityId: article.articleId,
          previousStatus,
          newStatus,
          actor,
          articleId: article.articleId,
          versionId: article.versionId,
          safeReason: String(input.reason || "Administrator review action."),
          sourceAction: `bulk_${action}`,
        });
      }
    }
    for (const [calendarItemId, update] of calendarUpdates) {
      transaction.update(db.collection(COLLECTIONS.calendar).doc(calendarItemId), update);
    }
    transaction.set(db.collection(COLLECTIONS.metrics).doc("aggregate"), {
      awaitingReview: FieldValue.increment(-selected.length),
      ...(["request_changes", "replace_article"].includes(action)
        ? { changesRequested: FieldValue.increment(selected.length) }
        : action === "reject"
          ? { rejected: FieldValue.increment(selected.length) }
          : {
            approved: FieldValue.increment(selected.length),
            ...(action === "approve_and_schedule"
              ? { scheduled: FieldValue.increment(selected.length) }
              : {}),
          }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(actionRef, {
      action: `bulk_review:${action}`,
      status: "completed",
      result: {
        ok: true,
        action,
        processed: selected.length,
        assignments,
        published: false,
        duplicatePrevented: false,
      },
      actor: safeActor(actor),
      completedAt: FieldValue.serverTimestamp(),
    });
    return {
      ok: true,
      action,
      processed: selected.length,
      assignments,
      published: false,
      duplicatePrevented: false,
    };
  });
  return transactionResult;
}

async function previewReviewSchedule(db, input) {
  const ids = [...new Set((input.articleIds || []).map(String))].slice(0, 10);
  if (!ids.length) throw new Error("Select at least one article.");
  const settings = await readSettings(db);
  const [queue, calendar] = await Promise.all([
    readReviewQueue(db, settings),
    readCalendar(db),
  ]);
  const selected = queue.filter((item) => ids.includes(item.articleId));
  if (
    selected.length !== ids.length
    || selected.some((item) => !item.eligibility.eligible)
  ) {
    throw new Error("Every selected article must pass review before scheduling.");
  }
  const selectedIds = new Set(ids);
  const schedulableCalendar = calendar.map((item) => (
    selectedIds.has(item.articleId)
      ? { ...item, articleId: null, versionId: null, status: "planned" }
      : item
  ));
  return {
    ok: true,
    articleIds: selected.map((item) => item.articleId),
    assignments: assignNextPublicationSlots(selected, schedulableCalendar, {
      limit: selected.length,
    }),
    published: false,
  };
}

async function saveBufferConfiguration(db, actor, input) {
  const channels = Array.isArray(input.channels) ? input.channels.slice(0, 50) : [];
  const selectedIds = [...new Set((input.enabledChannelIds || []).map(String))];
  const selection = validateChannelSelection(channels, selectedIds, {
    explicitlyApprovedPersonalLinkedInIds: input.explicitlyApprovedPersonalLinkedInIds || [],
  });
  if (!selection.valid) {
    const error = new Error(selection.errors.join(" "));
    error.code = "buffer/channel-selection-invalid";
    throw error;
  }
  const selected = selectableChannels(channels, selectedIds)
    .filter((channel) => channel.selected)
    .map((channel) => ({
      id: String(channel.id),
      service: String(channel.service),
      label: String(channel.name || channel.label || channel.id),
      timezone: String(input.timezone || "Europe/London"),
      postingPolicy: String(input.postingPolicy || "manual_approval"),
      enabled: true,
      personalLinkedInExplicitlyApproved: (
        input.explicitlyApprovedPersonalLinkedInIds || []
      ).map(String).includes(String(channel.id)),
    }));
  const ref = db.collection(COLLECTIONS.bufferConfig).doc(BUFFER_CONFIG_ID);
  await db.runTransaction(async (transaction) => {
    transaction.set(ref, {
      organisationId: String(input.organisationId || ""),
      channels: selected,
      enabled: input.enabled === true,
      timezone: String(input.timezone || "Europe/London"),
      postingPolicy: String(input.postingPolicy || "manual_approval"),
      lastCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: safeActor(actor),
    }, { merge: true });
  });
  return { ok: true, enabledChannels: selected.length };
}

export async function mutateSeoOperations(area, action, input, actor) {
  const db = getAdminDb();
  if (area === "calendar" && action === "initialise_plan") {
    return initialisePlan(db, actor, input);
  }
  if (area === "calendar" && action === "reschedule") {
    return rescheduleCalendarItem(db, actor, input);
  }
  if (area === "calendar" && action === "swap_slots") {
    return swapCalendarSlots(db, actor, input);
  }
  if (["calendar", "generate"].includes(area) && action === "update_brief") {
    return updateCalendarBrief(db, actor, input);
  }
  if (area === "settings" && action === "save") {
    return saveSettings(db, actor, input);
  }
  if (area === "generate" && action === "create_batch") {
    return createGenerationBatch(db, actor, input);
  }
  if (area === "review" && action === "bulk_review") {
    return reviewBulkAction(db, actor, input);
  }
  if (area === "review" && action === "preview_schedule") {
    return previewReviewSchedule(db, input);
  }
  if (area === "distribution" && action === "save_configuration") {
    return saveBufferConfiguration(db, actor, input);
  }
  throw new Error("Unsupported SEO operations action.");
}

export {
  BUFFER_CONFIG_ID,
  CALENDAR_LIMIT,
  COLLECTIONS,
  PLAN_ID,
  REVIEW_LIMIT,
  SETTINGS_ID,
};
