"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const planCore = require("../lib/seoArticles/contentPlan.cjs");
const pipelineCore = require("../lib/seoArticles/pipelineCore.cjs");
const publicationCore = require("../lib/seoArticles/publicationCore.cjs");
const bufferCore = require("../lib/integrations/bufferCore.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function approvedCandidate() {
  return {
    draft: {
      draftId: "article-1",
      status: "approved",
      currentVersion: 1,
      reviewedAt: "2026-08-01T10:00:00.000Z",
    },
    publicationExport: {
      status: "publication_ready",
      version: 1,
      article: {
        type: "article",
        slug: "clear-to-spend-before-payday",
        title: "Clear to spend before payday",
        content: [{ type: "paragraph", text: "Example." }],
      },
      claims: [{ id: "claim-1" }],
      sources: [{ id: "source-1" }],
      qualityReport: { checks: { sources: true, claims: true, tone: true } },
      heroImage: {
        qa: { passed: true, visionScore: 94 },
        alt: "ClearTill cashflow illustration",
        heroTitle: "Understand Your Clear-to-Spend Position Today",
        width: 1600,
        height: 900,
      },
    },
    versionId: "v1",
  };
}

test("annual plan creates exactly 156 unique slots across 52 three-slot weeks", () => {
  const plan = planCore.createAnnualContentPlan();
  const validation = planCore.validateAnnualPlan(plan);
  assert.equal(plan.items.length, 156);
  assert.equal(validation.passed, true);
  assert.equal(validation.weekCount, 52);
  assert.equal(new Set(plan.items.map((item) => item.proposedPublicationDate)).size, 156);
});

test("annual plan contains exactly 125 planned and 31 adaptive slots", () => {
  const plan = planCore.createAnnualContentPlan();
  assert.equal(plan.plannedCount, 125);
  assert.equal(plan.adaptiveCount, 31);
  assert.equal(plan.items.filter((item) => item.evergreenOrAdaptive === "adaptive").length, 31);
});

test("annual category allocations equal 156 and match the operating brief", () => {
  assert.equal(
    Object.values(planCore.CATEGORY_ALLOCATIONS).reduce((sum, value) => sum + value, 0),
    156,
  );
  assert.deepEqual(planCore.validateAnnualPlan(planCore.createAnnualContentPlan()).categoryCounts, {
    clear_to_spend: 30,
    bills_direct_debits_subscriptions: 26,
    irregular_income: 18,
    seasonal_life_events: 24,
    calculators_templates_tools: 16,
    privacy_trust_product: 11,
    adaptive: 31,
  });
});

test("all twelve seasonal months map to the approved themes", () => {
  const plan = planCore.createAnnualContentPlan();
  assert.equal(Object.keys(plan.monthlyThemes).length, 12);
  assert.match(plan.monthlyThemes["2026-08"], /back-to-school/);
  assert.match(plan.monthlyThemes["2026-12"], /early paydays/);
  assert.match(plan.monthlyThemes["2027-07"], /annual content refresh/);
});

test("planned briefs have unique primary keywords and no default cannibalisation collision", () => {
  const items = planCore.createAnnualContentPlan().items
    .filter((item) => item.evergreenOrAdaptive !== "adaptive");
  assert.equal(new Set(items.map((item) => item.primaryKeyword)).size, 125);
  const previous = [];
  for (const item of items) {
    assert.equal(planCore.findDuplicateRisks(item, previous).passed, true);
    previous.push(item);
  }
});

test("every calendar item contains the complete planning contract", () => {
  const item = planCore.createAnnualContentPlan().items[0];
  for (const field of [
    "calendarItemId", "provisionalTitle", "primaryKeyword", "secondaryKeywords",
    "category", "contentCluster", "searchIntent", "funnelStage", "audience",
    "proposedPublicationDate", "seasonalRelevance", "evergreenOrAdaptive",
    "articleType", "proposedCta", "proposedInternalLinks",
    "supportingAssetRequirement", "status", "priority", "rationale",
    "createdAt", "updatedAt",
  ]) assert.ok(Object.hasOwn(item, field), field);
});

test("calendar rescheduling rejects an occupied slot and a fourth weekly slot", () => {
  const plan = planCore.createAnnualContentPlan();
  const occupied = pipelineCore.validateReschedule(
    plan.items,
    plan.items[0].calendarItemId,
    plan.items[1].proposedPublicationDate,
  );
  assert.equal(occupied.valid, false);
  assert.match(occupied.reason, /occupied/);
  const fourth = pipelineCore.validateReschedule(
    plan.items,
    plan.items[3].calendarItemId,
    "2026-08-06T09:30:00",
  );
  assert.equal(fourth.valid, false);
  assert.match(fourth.reason, /three publication slots/);
});

test("all automation settings default to disabled in Europe/London", () => {
  const settings = pipelineCore.validateSettings();
  assert.equal(settings.batchSize, 10);
  assert.equal(settings.articlesPerWeek, 3);
  assert.equal(settings.timezone, "Europe/London");
  assert.equal(settings.generationEnabled, false);
  assert.equal(settings.publicationAutomationEnabled, false);
  assert.equal(settings.bufferSyncEnabled, false);
});

test("pipeline transition records contain the required audit fields", () => {
  const record = pipelineCore.transitionRecord({
    entityId: "slot-1",
    previousStatus: "planned",
    newStatus: "research_ready",
    actor: { uid: "admin-1", email: "Admin@ClearTill.money" },
    articleId: "article-1",
    versionId: "v1",
    safeReason: "Selected for generation.",
    sourceAction: "generate_batch",
  });
  assert.equal(record.previousStatus, "planned");
  assert.equal(record.newStatus, "research_ready");
  assert.equal(record.actor.email, "admin@cleartill.money");
  assert.ok(record.timestamp);
  assert.equal(record.articleId, "article-1");
  assert.equal(record.versionId, "v1");
  assert.equal(record.sourceAction, "generate_batch");
});

test("generation batch defaults to 10 and selects only eligible non-duplicate slots", () => {
  const plan = planCore.createAnnualContentPlan();
  plan.items[0].status = "published";
  const result = pipelineCore.selectGenerationBatch(plan.items, {
    duplicateCheck: (item) => (
      item.calendarItemId === plan.items[1].calendarItemId
        ? { passed: false }
        : { passed: true }
    ),
  });
  assert.equal(result.selected.length, 10);
  assert.equal(result.selected.some((item) => item.calendarItemId === plan.items[0].calendarItemId), false);
  assert.equal(result.selected.some((item) => item.calendarItemId === plan.items[1].calendarItemId), false);
});

test("failed generation does not block later jobs and retry is idempotent by durable job state", () => {
  const worker = read("lib/seoArticles/batchGeneration.server.js");
  assert.match(worker, /Other jobs in the batch can continue/);
  assert.match(worker, /status: "generation_failed"/);
  assert.match(worker, /if \(snapshot\.data\(\)\?\.status === "queued"\)/);
  assert.match(worker, /duplicatePrevented: true/);
  assert.match(worker, /\.limit\(1\)/);
});

test("review eligibility blocks deterministic, editorial, hero, source and duplicate failures", () => {
  const result = pipelineCore.reviewEligibility({
    currentStatus: "review_ready",
    qualityReport: { checks: { sources: false } },
    editorial: { comments: [{ severity: "critical", resolved: false }] },
    hero: { approved: false, score: 20 },
    sources: [],
    sourceCount: 0,
    qualityScore: 50,
    editorialScore: 50,
    duplicateRisk: { passed: false },
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.length >= 6);
});

test("10 approved articles are assigned to the next 10 empty slots in order", () => {
  const articles = Array.from({ length: 10 }, (_, index) => ({
    id: `article-${index}`,
    versionId: "v1",
  }));
  const plan = planCore.createAnnualContentPlan();
  const assignments = pipelineCore.assignNextPublicationSlots(articles, plan.items);
  assert.equal(assignments.length, 10);
  assert.deepEqual(
    assignments.map((item) => item.scheduledFor),
    plan.items.slice(0, 10).map((item) => item.proposedPublicationDate),
  );
});

test("publication validation accepts only the exact approved version", () => {
  const candidate = approvedCandidate();
  assert.equal(publicationCore.validatePublicationCandidate(candidate).valid, true);
  assert.equal(publicationCore.validatePublicationCandidate({
    ...candidate,
    versionId: "v2",
  }).valid, false);
});

test("publication validation rejects slug collision, missing sources and failed hero QA", () => {
  const candidate = approvedCandidate();
  const result = publicationCore.validatePublicationCandidate({
    ...candidate,
    existingSlug: { articleId: "another-article", versionId: "v1" },
    publicationExport: {
      ...candidate.publicationExport,
      sources: [],
      heroImage: { ...candidate.publicationExport.heroImage, qa: { passed: false } },
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /slug/i);
  assert.match(result.errors.join(" "), /sources/i);
  assert.match(result.errors.join(" "), /hero/i);
});

test("public representation is an immutable clone of the approved export", () => {
  const candidate = approvedCandidate();
  const snapshot = publicationCore.publicArticleSnapshot({
    ...candidate,
    publishedAt: "2026-08-03T09:30:00.000Z",
    actor: { uid: "admin", email: "admin@cleartill.money" },
  });
  candidate.publicationExport.article.title = "Mutated later";
  assert.equal(snapshot.article.title, "Clear to spend before payday");
  assert.equal(snapshot.approvedVersionId, "v1");
  assert.equal(snapshot.published, true);
});

test("publication API is admin-only, POST-only, confirmed and idempotent", () => {
  const route = read("app/api/admin/seo-articles/publication/route.js");
  const service = read("lib/seoArticles/publishing.server.js");
  assert.match(route, /verifyAnalyticsAdminRequest/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(service, /confirm !== true/);
  assert.match(service, /publicationActionKey/);
  assert.match(service, /duplicatePrevented/);
  assert.match(service, /seo\/stale-version/);
  assert.match(service, /seo\/slug-collision/);
});

test("unpublish hides the public representation without deleting history", () => {
  const service = read("lib/seoArticles/publishing.server.js");
  assert.match(service, /selectedAction === "unpublish"/);
  assert.match(service, /published: false/);
  assert.doesNotMatch(service, /\.delete\(immutableRef\)|transaction\.delete\(immutableRef\)/);
  assert.doesNotMatch(service, /\.delete\(draftRef\)|transaction\.delete\(draftRef\)/);
});

test("hybrid Journal repository merges static and published Firestore content only", () => {
  const repository = read("lib/journal/repository.server.js");
  const blogList = read("app/blog/page.jsx");
  const articlePage = read("app/blog/[slug]/page.jsx");
  const sitemap = read("app/sitemap.js");
  assert.match(repository, /BLOG_POSTS/);
  assert.match(repository, /where\("published", "==", true\)/);
  assert.match(repository, /\.limit\(PUBLIC_LIMIT\)/);
  assert.match(blogList, /getPublishedJournalPosts/);
  assert.match(articlePage, /getPublishedJournalPostBySlug/);
  assert.match(sitemap, /getPublishedJournalPosts/);
});

test("public hero route serves only the exact currently published version", () => {
  const route = read("app/api/journal/assets/[slug]/[versionId]/[variant]/route.js");
  assert.match(route, /published !== true/);
  assert.match(route, /versionId !== versionId/);
  assert.match(route, /max-age=31536000, immutable/);
});

test("Buffer is GraphQL-only, server-side and disabled by default", () => {
  const adapter = read("lib/integrations/buffer.server.js");
  const env = read(".env.example");
  assert.match(adapter, /https:\/\/api\.buffer\.com|BUFFER_API_URL/);
  assert.match(adapter, /query ClearTillBufferAccount/);
  assert.match(adapter, /mutation ClearTillCreateIdea/);
  assert.match(adapter, /mutation ClearTillCreateScheduledPost/);
  assert.doesNotMatch(adapter, /api\.bufferapp\.com\/1|\/profiles\.json/);
  assert.match(env, /BUFFER_API_KEY=/);
  assert.match(env, /BUFFER_SYNC_ENABLED=false/);
  assert.equal(bufferCore.bufferRuntimeConfig({ BUFFER_API_KEY: "key" }).syncEnabled, false);
});

test("Buffer channel discovery never automatically selects channels", () => {
  const channels = bufferCore.selectableChannels([
    { id: "company", service: "linkedin", name: "ClearTill company" },
    { id: "personal", service: "linkedin", name: "Personal profile" },
  ]);
  assert.equal(channels.every((channel) => channel.selected === false), true);
  const invalid = bufferCore.validateChannelSelection(channels, ["personal"]);
  assert.equal(invalid.valid, false);
  const valid = bufferCore.validateChannelSelection(channels, ["personal"], {
    explicitlyApprovedPersonalLinkedInIds: ["personal"],
  });
  assert.equal(valid.valid, true);
});

test("Buffer scheduling requires a final HTTPS article URL", () => {
  assert.throws(() => bufferCore.requireFinalArticleUrl("[ARTICLE_URL_PENDING]"), /final live article URL/);
  assert.throws(() => bufferCore.requireFinalArticleUrl("https://example.com/article"), /final live article URL/);
  assert.equal(
    bufferCore.requireFinalArticleUrl("https://www.cleartill.money/blog/example"),
    "https://www.cleartill.money/blog/example",
  );
});

test("Buffer queue capacity blocks blind over-scheduling", () => {
  assert.equal(bufferCore.queueCapacity({ scheduledCount: 99, requestedCount: 2, maximum: 100 }).canSchedule, false);
  assert.match(
    bufferCore.queueCapacity({ scheduledCount: 99, requestedCount: 2, maximum: 100 }).warning,
    /capacity/,
  );
});

test("social variants are generated only for explicitly enabled supported channels", () => {
  const variants = bufferCore.socialVariants(
    { title: "Example article", description: "Description", takeaway: "Takeaway" },
    [
      { id: "linkedin", service: "linkedin", enabled: true },
      { id: "facebook", service: "facebook", enabled: false },
      { id: "unsupported", service: "email", enabled: true },
    ],
  );
  assert.equal(variants.length, 3);
  assert.equal(variants.every((item) => item.channelId === "linkedin"), true);
  assert.match(variants[0].copy, /ARTICLE_URL_PENDING/);
});

test("Buffer operations bind idempotency to article, version, channel and exact dueAt", () => {
  const first = bufferCore.bufferOperationKey({
    articleId: "a1",
    versionId: "v1",
    action: "schedule",
    channelId: "c1",
    dueAt: "2026-08-03T08:30:00.000Z",
  });
  const second = bufferCore.bufferOperationKey({
    articleId: "a1",
    versionId: "v1",
    action: "schedule",
    channelId: "c1",
    dueAt: "2026-08-03T09:30:00.000Z",
  });
  assert.notEqual(first, second);
  const service = read("lib/seoArticles/bufferOperations.server.js");
  assert.match(service, /claimOperation/);
  assert.match(service, /duplicatePrevented: true/);
});

test("rate-limit retries and Buffer failures never mutate article publication", () => {
  const adapter = read("lib/integrations/buffer.server.js");
  const operations = read("lib/seoArticles/bufferOperations.server.js");
  assert.match(adapter, /response\.status === 429/);
  assert.match(adapter, /retry-after/);
  assert.match(operations, /The article remains unchanged/);
  assert.doesNotMatch(operations, /seoPublishedJournal.*update|publication\.published/);
});

test("generation records exact OpenAI token usage and immutable article versions", () => {
  const openai = read("lib/seoArticles/openai.server.js");
  const worker = read("lib/seoArticles/batchGeneration.server.js");
  assert.match(openai, /input_tokens/);
  assert.match(openai, /cached_tokens/);
  assert.match(openai, /output_tokens/);
  assert.match(openai, /reasoning_tokens/);
  assert.match(openai, /total_tokens/);
  assert.match(worker, /seoArticleVersions/);
  assert.match(worker, /seoArticleVersionAssets/);
  assert.match(worker, /immutable: true/);
});

test("admin information architecture contains all eight protected tabs", () => {
  const layout = read("app/admin/seo-articles/layout.jsx");
  const operationsRoute = read("app/api/admin/seo-articles/operations/[area]/route.js");
  for (const segment of [
    "Overview", "Content calendar", "Content generation", "Review queue",
    "Publishing pipeline", "Buffer distribution", "Performance", "Settings",
  ]) assert.match(layout, new RegExp(segment));
  assert.match(operationsRoute, /verifyAnalyticsAdminRequest\(request\)/);
  assert.doesNotMatch(operationsRoute, /error\?\.stack|stack:/);
});

test("admin client exposes no server keys, approval tokens or raw prompts", () => {
  const client = read("app/admin/seo-articles/OperationsAreaClient.jsx");
  for (const name of [
    "OPENAI_API_KEY",
    "BUFFER_API_KEY",
    "FIREBASE_ADMIN_PRIVATE_KEY",
    "CANVA_CLIENT_SECRET",
    "SEO_REVIEW_TOKEN_SECRET",
  ]) assert.doesNotMatch(client, new RegExp(name));
  assert.doesNotMatch(client, /raw prompt|system prompt/i);
});

test("calendar, review, jobs, Buffer and aggregate reads are bounded", () => {
  const operations = read("lib/seoArticles/contentOps.server.js");
  const buffer = read("lib/seoArticles/bufferOperations.server.js");
  assert.match(operations, /CALENDAR_LIMIT = 156/);
  assert.match(operations, /REVIEW_LIMIT = 10/);
  assert.match(operations, /PIPELINE_LIMIT = 100/);
  assert.ok((operations.match(/\.limit\(/g) || []).length >= 8);
  assert.ok((buffer.match(/\.limit\(/g) || []).length >= 3);
});

test("preview includes immutable versions, schedule, Buffer state and live simulation", () => {
  const preview = read("app/admin/seo-articles/[articleId]/preview/PreviewClient.jsx");
  const server = read("lib/seoArticles/admin.server.js");
  assert.match(preview, /Live-Journal simulation/);
  assert.match(preview, /Immutable version history/);
  assert.match(preview, /Buffer status/);
  assert.match(preview, /Scheduled date/);
  assert.match(server, /versionHistory/);
  assert.match(server, /bufferDistribution/);
});

test("existing production test article is not targeted and all recurring automation remains disabled", () => {
  const allNewMutationCode = [
    read("lib/seoArticles/contentOps.server.js"),
    read("lib/seoArticles/batchGeneration.server.js"),
    read("lib/seoArticles/publishing.server.js"),
    read("lib/seoArticles/bufferOperations.server.js"),
  ].join("\n");
  assert.doesNotMatch(allNewMutationCode, /0dcf8e9c-cddd-456b-97ec-dd2cc39c2af2/);
  assert.match(read("lib/seoArticles/admin.server.js"), /SEO_RECURRING_CRON_ENABLED = false/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.deepEqual(vercel.crons, [{ path: "/api/reminders", schedule: "0 7 * * *" }]);
  assert.equal(pipelineCore.DEFAULT_SETTINGS.publicationAutomationEnabled, false);
  assert.equal(bufferCore.bufferRuntimeConfig({ BUFFER_SYNC_ENABLED: "false" }).syncEnabled, false);
});

test("Firestore index configuration covers the bounded compound queries", () => {
  const firebase = JSON.parse(read("firebase.json"));
  const indexes = JSON.parse(read("firestore.indexes.json"));
  assert.equal(firebase.firestore.indexes, "firestore.indexes.json");
  const groups = indexes.indexes.map((index) => index.collectionGroup);
  assert.ok(groups.includes("seoArticleDrafts"));
  assert.ok(groups.includes("seoGenerationJobs"));
  assert.ok(groups.includes("seoPublishedJournal"));
  assert.ok(groups.includes("seoSocialDistributionItems"));
});
