"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateContentRecord, validateMarketingSystem, getContentById, channelDraft } = require("../lib/marketing/content");
const { buildCampaignUrl, validateLandingUrl } = require("../lib/marketing/utm");
const { normalizeMedia, toBufferAsset } = require("../lib/marketing/media");
const { assetDefinitions, generateInfographics } = require("../lib/marketing/infographics");
const { PixabayClient, assessCandidateRisk, buildPhotoCandidates, reusableCandidates } = require("../lib/marketing/stockPhotos");
const { JournalAdapter } = require("../lib/marketing/JournalAdapter");
const { JournalDraftAdapter, validateJournalDraft } = require("../lib/marketing/JournalDraftAdapter");
const { FUNNEL_MAPPING, mapMarketingEvent } = require("../lib/marketing/analyticsMapping");
const { SubmissionStore } = require("../lib/marketing/submissionStore");
const {
  assertNoSecrets,
  buildReviewModel,
  renderArticleReviewHtml,
  renderReviewHtml,
  validateCampaignAFigures,
  validateTemplateRegistry,
  writePdfFromHtml,
} = require("../lib/marketing/review");
const {
  BufferPublisher,
  BufferPublisherError,
  CREATE_POST,
  redactSecret,
} = require("../lib/marketing/publishers/BufferPublisher");

const baseRecord = () => {
  const record = JSON.parse(JSON.stringify(getContentById("ct-w01-b01")));
  record.channels.linkedin.enabled = true;
  delete record.channels.linkedin.disabledReason;
  return record;
};
const env = () => ({
  BUFFER_API_KEY: "buf_super_secret",
  BUFFER_ORGANIZATION_ID: "org_1",
  BUFFER_CHANNEL_LINKEDIN: "channel_li",
  BUFFER_CHANNEL_FACEBOOK: "channel_fb",
  BUFFER_CHANNEL_INSTAGRAM: "channel_ig",
  CONTENT_LIVE_PUBLISHING_ENABLED: "true",
});
const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  json: async () => body,
});
const tempStore = () => new SubmissionStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cleartill-marketing-")), "submissions.json"));
const approvedDraft = () => ({ ...channelDraft(baseRecord(), "linkedin"), status: "approved", claimsChecked: true, productFactsChecked: true });
const successfulPost = (id = "buffer_post_1") => response({ data: { createPost: { __typename: "PostActionSuccess", post: { id, text: "post", status: "draft", channelId: "channel_li", assets: [] } } } });

test("complete marketing records and the full system validate", () => {
  assert.equal(validateContentRecord(baseRecord()).valid, true);
  assert.deepEqual(validateMarketingSystem(), { valid: true, errors: [], records: 12 });
});

test("content validation rejects missing source or rationale", () => {
  const record = baseRecord();
  record.sourceOrRationale = "";
  assert.match(validateContentRecord(record).errors.join(" "), /sourceOrRationale/);
});

test("content validation rejects unsupported claims and invented testimonials", () => {
  const unsupported = baseRecord();
  unsupported.channels.linkedin.text += " Guaranteed and always accurate.";
  assert.match(validateContentRecord(unsupported).errors.join(" "), /Unsupported claim/);
  const testimonial = baseRecord();
  testimonial.channels.linkedin.text += " Our customers say it changed everything.";
  assert.match(validateContentRecord(testimonial).errors.join(" "), /testimonial/i);
});

test("content validation rejects unsupported channels", () => {
  const record = baseRecord();
  record.channels.tiktok = { text: "Unsupported." };
  assert.match(validateContentRecord(record).errors.join(" "), /Unsupported channel: tiktok/);
});

test("channel drafts cannot recreate a deliberately disabled channel", () => {
  const record = baseRecord();
  record.channels.linkedin.enabled = false;
  record.channels.linkedin.disabledReason = "Founder frequency decision.";
  assert.throws(() => channelDraft(record, "linkedin"), /disabled for linkedin/);
});

test("UTM generation uses lowercase controlled parameters and content attribution", () => {
  const url = new URL(buildCampaignUrl({
    landingPath: "/start",
    channel: "facebook",
    utm: { utm_source: "linkedin", utm_medium: "organic_social", utm_campaign: "launch_test", utm_content: "post_01", experiment_id: "message_a" },
  }));
  assert.equal(url.hostname, "www.cleartill.money");
  assert.equal(url.searchParams.get("utm_source"), "facebook");
  assert.equal(url.searchParams.get("content_id"), "post_01");
  const canonicalId = new URL(buildCampaignUrl({ landingPath: "/start", utm: { utm_source: "linkedin", utm_medium: "organic_social", utm_campaign: "launch_test", utm_content: "ct-w01-a01" } }));
  assert.equal(canonicalId.searchParams.get("utm_content"), "ct-w01-a01");
  assert.throws(() => buildCampaignUrl({ landingPath: "/start", utm: { utm_source: "LinkedIn", utm_medium: "organic_social", utm_campaign: "launch", utm_content: "post" } }), /snake_case/);
});

test("campaign records retain canonical per-channel URLs and validated arithmetic", () => {
  const record = JSON.parse(JSON.stringify(getContentById("ct-w01-a01")));
  assert.equal(validateContentRecord(record).valid, true);
  assert.equal(new URL(record.channels.facebook.url).searchParams.get("utm_source"), "facebook");
  record.illustrativeCalculations[0].result = 351;
  assert.match(validateContentRecord(record).errors.join(" "), /Invalid illustrative calculation/);
});

test("campaign destinations reject malicious external redirects and unapproved paths", () => {
  assert.throws(() => validateLandingUrl("https://evil.example/start"), /not an allowlisted/);
  assert.throws(() => validateLandingUrl("//evil.example/start"), /not an allowlisted/);
  assert.throws(() => validateLandingUrl("/api/stripe/webhook"), /not allowlisted/);
});

test("current Buffer asset input uses a single image variant with metadata", () => {
  const asset = toBufferAsset({ type: "image", url: "https://www.cleartill.money/social/card.png", altText: "Formula card", width: 1080, height: 1080 });
  assert.deepEqual(asset, { image: { url: "https://www.cleartill.money/social/card.png", metadata: { altText: "Formula card", dimensions: { width: 1080, height: 1080 } } } });
  assert.equal(Object.hasOwn(asset, "url"), false);
  assert.throws(() => normalizeMedia({ type: "image", url: "https://drive.google.com/file/1", altText: "Card" }), /Share-page/);
});

test("Buffer secrets are redacted from bearer values and error text", () => {
  const secret = "buf_super_secret";
  const safe = redactSecret(`Authorization: Bearer ${secret}; token=${secret}`, secret);
  assert.doesNotMatch(safe, new RegExp(secret));
  assert.match(safe, /REDACTED/);
});

test("Buffer reports missing environment variables without a network call", async () => {
  let calls = 0;
  const publisher = new BufferPublisher({ env: { BUFFER_CHANNEL_LINKEDIN: "channel_li" }, fetchImpl: async () => { calls += 1; }, submissionStore: tempStore() });
  await assert.rejects(() => publisher.createDraft(channelDraft(baseRecord(), "linkedin")), (error) => error.code === "MISSING_ENV" && /BUFFER_API_KEY/.test(error.message));
  assert.equal(calls, 0);
});

test("channel discovery uses the organization-scoped GraphQL query", async () => {
  let requestBody;
  const publisher = new BufferPublisher({ env: env(), fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return response({ data: { channels: [{ id: "channel_li", name: "ClearTill", displayName: "ClearTill", service: "linkedin", isQueuePaused: false }] } });
  }, submissionStore: tempStore() });
  const channels = await publisher.listChannels();
  assert.equal(requestBody.variables.input.organizationId, "org_1");
  assert.equal(channels[0].channel, "linkedin");
});

test("createPost payload matches the current GraphQL draft structure", () => {
  const publisher = new BufferPublisher({ env: env(), submissionStore: tempStore() });
  const payload = publisher.buildCreatePostPayload(channelDraft(baseRecord(), "linkedin"), { draft: true });
  assert.match(CREATE_POST, /createPost\(input: \$input\)/);
  assert.match(CREATE_POST, /PostActionSuccess/);
  assert.match(CREATE_POST, /MutationError/);
  assert.equal(payload.variables.input.saveToDraft, true);
  assert.equal(payload.variables.input.mode, "addToQueue");
  assert.equal(payload.variables.input.assets.length, 1);
  assert.equal(payload.variables.input.assets[0].image.url, "https://www.cleartill.money/marketing/campaigns/ct-w01-b01-social-landscape-v02.png");
  assert.equal(payload.variables.input.assets[0].image.metadata.altText, baseRecord().channels.linkedin.media.altText);
});

test("Buffer adds required Facebook and Instagram post metadata", () => {
  const publisher = new BufferPublisher({ env: env(), submissionStore: tempStore() });
  const facebook = publisher.buildCreatePostPayload(channelDraft(baseRecord(), "facebook"), { draft: true });
  const instagram = publisher.buildCreatePostPayload(channelDraft(baseRecord(), "instagram"), { draft: true });
  assert.deepEqual(facebook.variables.input.metadata, { facebook: { type: "post" } });
  assert.deepEqual(instagram.variables.input.metadata, { instagram: { type: "post", shouldShareToFeed: true } });
});

test("Buffer draft updates preserve draft mode and replace assets without changing channel", () => {
  const publisher = new BufferPublisher({ env: env(), submissionStore: tempStore() });
  const payload = publisher.buildEditPostPayload(channelDraft(baseRecord(), "instagram"), "post_123");
  assert.equal(payload.variables.input.id, "post_123");
  assert.equal(payload.variables.input.saveToDraft, true);
  assert.equal(payload.variables.input.channelId, undefined);
  assert.equal(payload.variables.input.assets.length, 1);
  assert.deepEqual(payload.variables.input.metadata, { instagram: { type: "post", shouldShareToFeed: true } });
});

test("submission ledger removes only the exact confirmed draft record", () => {
  const store = tempStore();
  store.record({ contentId: "a", channel: "linkedin", mode: "draft", remotePostId: "one" });
  store.record({ contentId: "b", channel: "linkedin", mode: "draft", remotePostId: "two" });
  assert.equal(store.remove("a", "linkedin", "draft"), true);
  assert.equal(store.find("a", "linkedin", "draft"), null);
  assert.equal(store.find("b", "linkedin", "draft").remotePostId, "two");
});

test("draft creation stores the remote post ID and blocks duplicates", async () => {
  const store = tempStore();
  let calls = 0;
  const publisher = new BufferPublisher({ env: env(), fetchImpl: async () => { calls += 1; return successfulPost(); }, submissionStore: store });
  const content = channelDraft(baseRecord(), "linkedin");
  const result = await publisher.createDraft(content);
  assert.equal(result.post.id, "buffer_post_1");
  assert.equal(store.find(content.contentId, "linkedin", "draft").remotePostId, "buffer_post_1");
  await assert.rejects(() => publisher.createDraft(content), (error) => error.code === "DUPLICATE_SUBMISSION");
  assert.equal(calls, 1);
});

test("scheduling enforces live switch, approval, fact checks and explicit confirmation", async () => {
  const dueAt = "2026-07-20T09:00:00.000Z";
  const now = () => new Date("2026-07-19T08:00:00.000Z");
  const disabled = new BufferPublisher({ env: { ...env(), CONTENT_LIVE_PUBLISHING_ENABLED: "false" }, now, submissionStore: tempStore() });
  await assert.rejects(() => disabled.schedulePost(approvedDraft(), dueAt, { confirmPublish: true }), (error) => error.code === "LIVE_PUBLISHING_DISABLED");
  const publisher = new BufferPublisher({ env: env(), now, submissionStore: tempStore() });
  await assert.rejects(() => publisher.schedulePost({ ...approvedDraft(), status: "draft" }, dueAt, { confirmPublish: true }), (error) => error.code === "APPROVAL_REQUIRED");
  await assert.rejects(() => publisher.schedulePost({ ...approvedDraft(), claimsChecked: false }, dueAt, { confirmPublish: true }), (error) => error.code === "CLAIMS_CHECK_REQUIRED");
  await assert.rejects(() => publisher.schedulePost({ ...approvedDraft(), productFactsChecked: false }, dueAt, { confirmPublish: true }), (error) => error.code === "PRODUCT_FACTS_CHECK_REQUIRED");
  await assert.rejects(() => publisher.schedulePost(approvedDraft(), dueAt), (error) => error.code === "CONFIRMATION_REQUIRED");
});

test("scheduling rejects past dates", async () => {
  const publisher = new BufferPublisher({ env: env(), now: () => new Date("2026-07-20T10:00:00.000Z"), submissionStore: tempStore() });
  await assert.rejects(() => publisher.schedulePost(approvedDraft(), "2026-07-20T09:00:00.000Z", { confirmPublish: true }), (error) => error.code === "PAST_SCHEDULE_DATE");
});

test("mocked successful scheduling stores the remote ID and prevents a second live submission", async () => {
  const store = tempStore();
  let calls = 0;
  const publisher = new BufferPublisher({ env: env(), now: () => new Date("2026-07-19T08:00:00.000Z"), fetchImpl: async () => { calls += 1; return successfulPost("scheduled_1"); }, submissionStore: store });
  const content = approvedDraft();
  const result = await publisher.schedulePost(content, "2026-07-20T09:00:00.000Z", { confirmPublish: true });
  assert.equal(result.post.id, "scheduled_1");
  await assert.rejects(() => publisher.schedulePost(content, "2026-07-21T09:00:00.000Z", { confirmPublish: true }), (error) => error.code === "DUPLICATE_SUBMISSION");
  assert.equal(calls, 1);
});

test("GraphQL response errors and typed mutation errors are distinct safe failures", async () => {
  const graphql = new BufferPublisher({ env: env(), fetchImpl: async () => response({ errors: [{ message: "Not authorized buf_super_secret", extensions: { code: "UNAUTHORIZED" } }] }), submissionStore: tempStore() });
  await assert.rejects(() => graphql.createDraft(channelDraft(baseRecord(), "linkedin")), (error) => error.code === "UNAUTHORIZED" && !error.message.includes("buf_super_secret"));
  const typed = new BufferPublisher({ env: env(), fetchImpl: async () => response({ data: { createPost: { __typename: "InvalidInputError", message: "Text is required" } } }), submissionStore: tempStore() });
  await assert.rejects(() => typed.createDraft(channelDraft(baseRecord(), "linkedin")), (error) => error.code === "BUFFER_MUTATION_ERROR");
});

test("HTTP errors remain separate from GraphQL errors and auth failures are not retried", async () => {
  let calls = 0;
  const publisher = new BufferPublisher({ env: env(), maxRetries: 3, fetchImpl: async () => { calls += 1; return response({}, 401); }, submissionStore: tempStore() });
  await assert.rejects(() => publisher.createDraft(channelDraft(baseRecord(), "linkedin")), (error) => error.code === "BUFFER_AUTH_ERROR" && error.status === 401);
  assert.equal(calls, 1);
});

test("429 responses use bounded retry behaviour", async () => {
  let calls = 0;
  const publisher = new BufferPublisher({ env: env(), maxRetries: 1, sleep: async () => {}, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? response({}, 429, { "retry-after": "1" }) : successfulPost();
  }, submissionStore: tempStore() });
  const result = await publisher.createDraft(channelDraft(baseRecord(), "linkedin"));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("network timeout returns a structured timeout error", async () => {
  const publisher = new BufferPublisher({ env: env(), timeoutMs: 10, fetchImpl: async () => new Promise(() => {}), submissionStore: tempStore() });
  await assert.rejects(() => publisher.createDraft(channelDraft(baseRecord(), "linkedin")), (error) => error instanceof BufferPublisherError && error.code === "BUFFER_TIMEOUT");
});

test("dry run builds a draft without making a network call or recording a submission", async () => {
  let calls = 0;
  const store = tempStore();
  const publisher = new BufferPublisher({ env: env(), dryRun: true, fetchImpl: async () => { calls += 1; }, submissionStore: store });
  const content = channelDraft(baseRecord(), "linkedin");
  const result = await publisher.createDraft(content);
  assert.equal(result.dryRun, true);
  assert.equal(calls, 0);
  assert.equal(store.find(content.contentId, "linkedin", "draft"), null);
});

test("Journal adapter creates unapproved channel drafts from approved article data", () => {
  const result = new JournalAdapter().repurpose({ type: "article", slug: "example", title: "A clear title", description: "A sourced description.", takeaway: "A useful takeaway." });
  assert.equal(result.status, "draft");
  assert.equal(result.claimsChecked, false);
  assert.match(result.channels.linkedin.text, /A clear title/);
  assert.throws(() => new JournalAdapter().repurpose({ type: "tool", slug: "x" }), /approved article/);
});

test("Journal draft adapter keeps complete articles outside the live collection", () => {
  const adapter = new JournalDraftAdapter();
  const draft = adapter.create({
    contentId: "ct-w01-test",
    hypothesis: "A draft hypothesis.",
    primaryMeasurementGoal: "A draft measurement goal.",
    campaign: { name: "draft_campaign" },
    article: { type: "article", slug: "draft-article", title: "Draft article", seoTitle: "Draft article", description: "Draft description.", category: "money-basics", readingMinutes: 3, takeaway: "Draft takeaway.", content: [{ type: "paragraph", text: "Draft body." }] },
    heroImage: { visualBrief: "Draft hero brief.", expectedCanvaExportFilename: "draft.png", altText: "Draft hero." },
    illustrativeCalculations: [{ label: "draft calculation", start: 100, deductions: [25, 15], totalDeductions: 40, result: 60 }],
  });
  assert.equal(validateJournalDraft(draft).valid, true);
  assert.equal(draft.publication.publishedAt, null);
  assert.equal(draft.publication.exportedToLiveCollection, false);
  assert.equal(Object.hasOwn(draft.article, "publishedAt"), false);
  assert.equal(Object.values(draft.approvalChecks).every((value) => value === false), true);
  const incorrect = JSON.parse(JSON.stringify(draft));
  incorrect.illustrativeCalculations[0].result = 61;
  assert.match(validateJournalDraft(incorrect).errors.join(" "), /Invalid illustrative calculation/);
});

test("analytics mapping reuses existing events and keeps purchase completion webhook-derived", () => {
  assert.equal(mapMarketingEvent("preview_started").existingEvent, "preview_started");
  assert.equal(FUNNEL_MAPPING.purchase_completed.existingEvent, "first_invoice_paid");
  assert.match(FUNNEL_MAPPING.purchase_completed.capture, /webhook/i);
  assert.throws(() => mapMarketingEvent("invented_event"), /Unsupported/);
});

test("Canva registry records the canonical folder and safe automation modes", () => {
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../marketing/creative/canva-template-registry.json"), "utf8"));
  assert.equal(validateTemplateRegistry(registry).valid, true);
  assert.equal(registry.canonicalFolder.url, "https://www.canva.com/folder/FAHP8Xz8OL4");
  assert.equal(registry.canonicalFolder.autofillTemplatesWithNamedFields, 0);
  assert.equal(registry.campaignMappings["ct-w01-c01"].includes("product_screenshot_frame"), true);
  assert.equal(registry.templates.some((template) => template.automationMode === "native_copy" && template.canvaDesignId), true);
  assert.equal(registry.templates.some((template) => template.automationMode === "autofill"), false);
});

test("infographic workaround generates complete import-ready artwork from campaign data", async () => {
  const definitions = assetDefinitions();
  assert.equal(definitions.length, 12);
  assert.equal(definitions.filter((asset) => asset.contentId === "ct-w01-a01").length, 7);
  assert.match(definitions.find((asset) => asset.key === "a-carousel-03-calculation").svg, /£1,250 − £1,015 = £235/);
  assert.equal(definitions.find((asset) => asset.key === "c-product-frame").role, "recording_frame");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleartill-infographics-"));
  const manifest = await generateInfographics({ outputRoot: path.join(directory, "assets"), manifestPath: path.join(directory, "manifest.json"), assetRegisterPath: path.join(directory, "asset-register.json"), generatedAt: "2026-07-21T20:00:00.000Z" });
  assert.equal(manifest.assets.length, 12);
  assert.equal(manifest.assets.every((asset) => fs.statSync(path.join(directory, "assets", path.basename(asset.pngPath))).size > 1000), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "asset-register.json"), "utf8")).assets.length, 12);
});

test("Pixabay integration is server-only, safe-search constrained and keeps the key out of candidates", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({ totalHits: 1, hits: [{ id: 42, pageURL: "https://pixabay.com/photos/budget-42/", webformatURL: "https://cdn.pixabay.com/photo/preview.jpg", largeImageURL: "https://cdn.pixabay.com/photo/large.jpg", imageWidth: 2400, imageHeight: 1600, tags: "budget, notebook, planning", user: "Example Artist", user_id: 7 }] })
    };
  };
  const briefs = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../marketing/creative/stock-photo-briefs.json"), "utf8"));
  const candidates = await buildPhotoCandidates({ ids: ["ct-w01-a01", "ct-w01-c01"], apiKey: "private_pixabay_key", fetchImpl, now: new Date("2026-07-21T18:00:00.000Z"), briefs });
  assert.equal(requestedUrl.origin, "https://pixabay.com");
  assert.equal(requestedUrl.searchParams.get("safesearch"), "true");
  assert.equal(requestedUrl.searchParams.get("image_type"), "photo");
  assert.equal(candidates.campaigns["ct-w01-a01"].candidates[0].creator, "Example Artist");
  assert.equal(candidates.campaigns["ct-w01-a01"].candidates[0].rightsChecks.licenceChecked, false);
  assert.equal(candidates.campaigns["ct-w01-c01"].status, "not_required");
  assert.doesNotMatch(JSON.stringify(candidates), /private_pixabay_key/);
});

test("Pixabay search fails safely when the server-only key is missing", async () => {
  let called = false;
  const client = new PixabayClient({ apiKey: "", fetchImpl: async () => { called = true; } });
  await assert.rejects(client.search("budget planning"), (error) => error.code === "PIXABAY_API_KEY_MISSING");
  assert.equal(called, false);
});

test("Pixabay search enforces query limits and reuses an unexpired 24-hour cache", async () => {
  const client = new PixabayClient({ apiKey: "private", fetchImpl: async () => { throw new Error("must not call"); } });
  await assert.rejects(client.search("x".repeat(101)), /100 characters/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleartill-pixabay-"));
  const candidatesPath = path.join(directory, "candidates.json");
  const briefs = { campaigns: { "ct-w01-a01": { query: "calculator notebook" } } };
  fs.writeFileSync(candidatesPath, JSON.stringify({ status: "candidates_for_review", expiresAt: "2026-07-22T18:00:00.000Z", campaigns: { "ct-w01-a01": { query: "calculator notebook", candidates: [] } } }));
  assert.ok(reusableCandidates(["ct-w01-a01"], { now: new Date("2026-07-21T19:00:00.000Z"), candidatesPath, briefs }));
  assert.equal(reusableCandidates(["ct-w01-a01"], { now: new Date("2026-07-23T19:00:00.000Z"), candidatesPath, briefs }), null);
  assert.equal(reusableCandidates(["ct-w01-a01"], { now: new Date("2026-07-21T19:00:00.000Z"), candidatesPath, briefs: { campaigns: { "ct-w01-a01": { query: "changed query" } } } }), null);
});

test("Pixabay candidate curation flags brands, sensitive people and unsuitable currencies", () => {
  assert.deepEqual(assessCandidateRisk({ tags: ["apple", "woman", "rupee"] }), {
    automatedRiskFlags: [
      "recognisable technology brand or product may be visible",
      "recognisable person may require sensitive-context review",
      "currency or tax context may be unsuitable for a UK campaign"
    ],
    selectionStatus: "needs_caution"
  });
  assert.equal(assessCandidateRisk({ tags: ["calendar", "notebook", "desk"] }).selectionStatus, "candidate_for_visual_review");
});

test("review model renders published Journal records, metadata, approvals, URLs and creative blockers", () => {
  const liveBefore = fs.readFileSync(path.resolve(__dirname, "../app/blog/posts.js"), "utf8");
  const model = buildReviewModel(["ct-w01-a01", "ct-w01-b01", "ct-w01-c01"], { generatedAt: "2026-07-21T17:30:00.000Z" });
  const html = renderReviewHtml(model);
  assert.match(html, /DRAFT — NOT PUBLISHED/);
  assert.match(html, /Approval summary/);
  assert.match(html, /Meta title/);
  assert.match(html, /Meta description/);
  assert.match(html, /Desktop article preview/);
  assert.match(html, /Narrow mobile article preview/);
  assert.match(html, /href="https:\/\/www\.cleartill\.money\/start\?utm_source=linkedin/);
  assert.match(html, /https:\/\/www\.canva\.com\/folder\/FAHP8Xz8OL4|Open Canva source/);
  assert.match(html, /https:\/\/www\.canva\.com\/design\/DAHQDGIRnyA\/edit/);
  assert.doesNotMatch(html, /No generated campaign Canva design link is registered/);
  assert.match(html, /https:\/\/www\.canva\.com\/design\/DAHP8e1Iflg\/edit/);
  assert.match(html, /Optional stock-photo review/);
  assert.match(html, /Generated supporting infographics/);
  assert.match(html, /a-carousel-03-calculation/);
  assert.match(html, /Images and videos via Pixabay/);
  assert.match(html, /Pixabay ID/);
  assert.match(html, /No stock photography\. Use the real ClearTill test-account recording/);
  assert.match(html, /Real ClearTill product demonstration/);
  assert.match(html, /<video controls playsinline/);
  assert.match(html, /2026-07-31_ct-w01-c01_portrait_reel_v05\.mp4/);
  assert.match(html, /2026-07-31_ct-w01-c01_landscape_product-demo_v05\.mp4/);
  assert.match(html, /original soundtrack/);
  assert.match(html, /2026-07-31_ct-w01-c01_instagram_reel-cover_v02\.png/);
  assert.doesNotMatch(model.campaigns.find((item) => item.record.id === "ct-w01-c01").blockers.join(" "), /recording is still required/i);
  assert.equal(model.articles.every((item) => Boolean(item.record.publication.publishedAt)), true);
  assert.equal(model.articles.every((item) => item.record.publication.exportedToLiveCollection === true), true);
  assert.equal(model.articles.every((item) => Object.values(item.record.approvalChecks).every(Boolean)), true);
  assert.equal(model.summary.approved, 2);
  assert.equal(assertNoSecrets(html), true);
  assert.equal(fs.readFileSync(path.resolve(__dirname, "../app/blog/posts.js"), "utf8"), liveBefore);
});

test("standalone article review uses the same source model and complete Journal renderer", () => {
  const model = buildReviewModel(["ct-w01-a01", "ct-w01-b01", "ct-w01-c01"], { generatedAt: "2026-07-21T17:30:00.000Z" });
  const article = model.articles.find((item) => item.record.contentId === "ct-w01-a01");
  const html = renderArticleReviewHtml(model, article);
  assert.match(html, new RegExp(model.modelDigest));
  assert.match(html, /Headings hierarchy/);
  assert.match(html, /Illustrative costs due before payday/);
  assert.match(html, /£1,250 − £1,015 = £235/);
  assert.match(html, /Product and claims qualifications/);
});

test("Campaign-A conflicting illustrative figures are rejected", () => {
  const campaign = JSON.parse(JSON.stringify(getContentById("ct-w01-a01")));
  const journal = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../marketing/drafts/journal/why-your-bank-balance-is-not-always-what-you-can-spend.json"), "utf8"));
  assert.equal(validateCampaignAFigures(campaign, journal).valid, true);
  campaign.illustrativeCalculations[0].result = 236;
  assert.match(validateCampaignAFigures(campaign, journal).errors.join(" "), /£1,250 − £1,015 = £235/);
});

test("PDF renderer uses the generated HTML source without Firebase or application context", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleartill-review-"));
  const htmlPath = path.join(directory, "review.html");
  const pdfPath = path.join(directory, "review.pdf");
  fs.writeFileSync(htmlPath, "<!doctype html><title>Draft review</title><p>DRAFT — NOT PUBLISHED</p>");
  const calls = [];
  const launch = async (options) => ({
    newPage: async () => ({
      goto: async (url, gotoOptions) => calls.push(["goto", url, gotoOptions]),
      emulateMedia: async (options) => calls.push(["media", options]),
      pdf: async (options) => { calls.push(["pdf", options]); fs.writeFileSync(options.path, "%PDF-1.4\n"); },
    }),
    close: async () => calls.push(["close"]),
  });
  await writePdfFromHtml(htmlPath, pdfPath, { launch });
  assert.equal(fs.existsSync(pdfPath), true);
  assert.match(calls[0][1], /^file:/);
  assert.equal(calls.find(([name]) => name === "pdf")[1].displayHeaderFooter, true);
  assert.equal(calls.some(([name]) => name === "close"), true);
});
