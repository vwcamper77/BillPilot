"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  runDeterministicQualityGates,
  validateStructuredArticleOutput,
} = require("../lib/seoArticles/articleGeneration.cjs");
const {
  buildCanvaFallbackPlan,
  normalizeCapabilitySnapshot,
  signReviewToken,
  verifyReviewToken,
} = require("../lib/seoArticles/articleCore.cjs");
const {
  FONT_PATH,
  buildHeroLayout,
  generateNativeHero,
  renderNativeHeroSvg,
  resolveRenderFont,
  resolveRenderedLayout,
  validateHeroLayout,
  validatePostRender,
  validateSvgStructure,
} = require("../lib/seoArticles/nativeHero.cjs");
const {
  generateHeroWithQualityGate,
} = require("../lib/seoArticles/heroQuality.cjs");
const {
  dailyRunId,
  publicationBoundary,
  shouldGenerateDailyRun,
  shouldSendReviewEmail,
} = require("../lib/seoArticles/workflowCore.cjs");
const {
  getSeoArticleRuntimeConfig,
} = require("../lib/seoArticles/runtimeConfig.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function completeOutput() {
  return {
    article: {
      type: "article",
      slug: "planning-direct-debits-around-payday",
      title: "How to plan UK direct debits around payday",
      seoTitle: "How to Plan Direct Debits Around Payday",
      description: "A practical UK guide to listing direct debits, checking due dates and estimating what remains before your next payday.",
      keywords: ["direct debits", "payday planning", "UK bills"],
      category: "bills-and-payday",
      readingMinutes: 6,
      takeaway: "List each dated commitment and update the figures whenever your balance, bills or payday changes.",
      disclaimer: "This is general information, not personalised financial advice. ClearTill outputs are estimates based on the figures entered.",
      content: [
        { type: "paragraph", id: "", text: "UK households can use a simple list of direct debits to see what is due before payday.", items: [], claimIds: ["claim-1"] },
        { type: "heading", id: "start-with-dates", text: "Start with dates", items: [], claimIds: [] },
        { type: "paragraph", id: "", text: "Write down each amount and due date from your own records.", items: [], claimIds: [] },
        { type: "heading", id: "check-payday", text: "Check your payday", items: [], claimIds: [] },
        { type: "paragraph", id: "", text: "Use the date the income is expected to arrive.", items: [], claimIds: [] },
        { type: "heading", id: "allow-for-bills", text: "Allow for bills", items: [], claimIds: [] },
        { type: "list", id: "", text: "", items: ["Council tax", "Energy", "Phone"], claimIds: [] },
        { type: "heading", id: "review", text: "Review the estimate", items: [], claimIds: [] },
        { type: "paragraph", id: "", text: "Review the estimate whenever a figure changes.", items: [], claimIds: [] },
        { type: "paragraph", id: "", text: "ClearTill does not connect to your bank and relies on manually entered figures.", items: [], claimIds: [] },
      ],
    },
    claims: [{
      id: "claim-1",
      statement: "Direct Debits are covered by a UK guarantee.",
      material: true,
      sourceIds: ["source-1"],
    }],
    sources: [{
      id: "source-1",
      title: "Direct Debit Guarantee",
      url: "https://www.directdebit.co.uk/direct-debit-explained/",
      publisher: "Pay.UK",
      publishedAt: null,
      accessedAt: "2026-07-29",
      claimIds: ["claim-1"],
    }],
    heroTitle: "Plan UK Direct Debits Around Your Next Payday",
    heroAltText: "ClearTill illustration showing a UK payday plan and a short list of upcoming direct debits.",
  };
}

test("OpenAI structured article output accepts a complete sourced result", () => {
  const result = validateStructuredArticleOutput(completeOutput());
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("OpenAI structured article output rejects unlinked material claims", () => {
  const output = completeOutput();
  output.claims[0].sourceIds = [];
  const result = validateStructuredArticleOutput(output);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Material claim claim-1 has no source/);
});

test("heroTitle is separate from the full article title and constrained to 45–60 characters", () => {
  const output = completeOutput();
  output.article.title = "A Complete Search-Focused Guide to Planning UK Direct Debits Around Payday";
  assert.equal(validateStructuredArticleOutput(output).valid, true);
  output.heroTitle = "Too short";
  const invalid = validateStructuredArticleOutput(output);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /Hero title must be between 45 and 60 characters/);
});

test("deterministic quality gates reject unsupported claims", () => {
  const output = completeOutput();
  output.article.content[2].text = "ClearTill is guaranteed and always accurate.";
  const report = runDeterministicQualityGates(output);
  assert.equal(report.passed, false);
  assert.equal(report.checks.claimsPolicy, false);
  assert.match(report.errors.join(" "), /Unsupported claim detected/);
});

test("daily run state prevents duplicate generation", () => {
  const now = Date.parse("2026-07-29T08:00:00Z");
  assert.equal(dailyRunId("2026-07-29"), "daily-2026-07-29");
  assert.equal(shouldGenerateDailyRun(null, now), true);
  assert.equal(shouldGenerateDailyRun({ status: "generating", leaseExpiresAtMs: now + 60_000 }, now), false);
  assert.equal(shouldGenerateDailyRun({ status: "email_sent" }, now), false);
  assert.equal(shouldGenerateDailyRun({ status: "failed" }, now), true);
});

test("review email state prevents duplicate delivery", () => {
  const now = Date.parse("2026-07-29T08:00:00Z");
  assert.equal(shouldSendReviewEmail({ status: "email_pending", emailStatus: "pending" }, now), true);
  assert.equal(shouldSendReviewEmail({ status: "email_sent", emailStatus: "sent" }, now), false);
  assert.equal(shouldSendReviewEmail({
    status: "email_sending",
    emailStatus: "sending",
    emailLeaseExpiresAtMs: now + 60_000,
  }, now), false);
});

test("Canva no-autofill capability always uses the native fallback", () => {
  const snapshot = normalizeCapabilitySnapshot({
    connected: true,
    workspace: "workspace-1",
    capabilities: { brand_template: true, autofill: false, resize: true },
  }, "2026-07-29T08:00:00.000Z");
  const plan = buildCanvaFallbackPlan(snapshot);
  assert.equal(plan.primaryImageSource, "cleartill_native");
  assert.equal(plan.autofillRequired, false);
  assert.equal(plan.canPublishWithoutCanva, true);
  assert.equal(plan.steps.listBrandTemplates, true);
  assert.equal(plan.steps.resize, true);
  assert.equal(plan.steps.export, true);
});

test("approval and publication remain separate", () => {
  assert.deepEqual(publicationBoundary("approve"), {
    action: "approve",
    createsPublicationReadyExport: true,
    writesLiveArticle: false,
    automaticPublication: false,
  });
  const engine = read("lib/seoArticles/engine.server.js");
  assert.match(engine, /seoArticleExports/);
  assert.doesNotMatch(engine, /collection\("seoArticles"\)/);
  assert.match(engine, /exportedToLiveCollection: false/);
  assert.match(engine, /published: false/);
});

test("signed actions validate and GET cannot approve", () => {
  const secret = "test-secret-at-least-long-enough";
  const token = signReviewToken({
    draftId: "draft-1",
    slug: "example-article",
    action: "approve",
    expiresAt: Date.now() + 60_000,
  }, secret);
  assert.equal(verifyReviewToken(token, secret).action, "approve");
  const actionRoute = read("app/api/seo-articles/review/route.js");
  assert.match(actionRoute, /export async function POST/);
  assert.doesNotMatch(actionRoute, /export async function GET/);
});

test("native hero is a branded SVG and compact PNG", async () => {
  const output = completeOutput();
  const hero = await generateNativeHero(output.article, {
    altText: output.heroAltText,
    heroTitle: output.heroTitle,
  });
  assert.equal(hero.source, "cleartill_native");
  assert.equal(hero.png.subarray(1, 4).toString("ascii"), "PNG");
  assert.match(hero.svg, /ClearTill Journal/);
  assert.ok(hero.svg.includes("data:image/svg+xml;base64"));
  assert.ok(hero.png.length < 700_000);
});

test("long hero titles wrap within three lines at the minimum font size", () => {
  const output = completeOutput();
  const layout = buildHeroLayout(output.article, {
    heroTitle: "Review Every UK Subscription Before Your Upcoming Payday",
  });
  const validation = validateHeroLayout(layout);
  assert.ok(layout.titleLines.length <= 3);
  assert.ok(layout.titleFontSize >= 66);
  assert.equal(validation.passed, true);
  assert.ok(validation.boundingBoxes.title.right <= 1520);
});

test("deterministic hero validation rejects title and illustration collisions", () => {
  const output = completeOutput();
  const layout = buildHeroLayout(output.article, { heroTitle: output.heroTitle });
  layout.boxes.illustration = { ...layout.boxes.title };
  const validation = validateHeroLayout(layout);
  assert.equal(validation.passed, false);
  assert.ok(validation.issues.some((issue) => issue.code === "title-illustration-intersection"));
});

test("deterministic hero validation rejects left-edge clipping", () => {
  const output = completeOutput();
  const layout = buildHeroLayout(output.article, { heroTitle: output.heroTitle });
  layout.boxes.title.x = 30;
  const validation = validateHeroLayout(layout);
  assert.equal(validation.passed, false);
  assert.ok(validation.issues.some((issue) => issue.code === "title-outside-safe-area"));
});

test("native hero creates an exact 390px mobile downscale", async () => {
  const output = completeOutput();
  const hero = await generateNativeHero(output.article, {
    heroTitle: output.heroTitle,
    altText: output.heroAltText,
  });
  const metadata = await require("sharp")(hero.mobilePng).metadata();
  assert.equal(metadata.width, 390);
  assert.equal(hero.mobileWidth, 390);
  assert.equal(hero.mobileHeight, 219);
  assert.ok(hero.layoutValidation.mobileTitleFontSize >= 16);
});

test("production font fallback is explicit and measurement uses the rendered font asset", async () => {
  const embedded = resolveRenderFont();
  const productionPath = resolveRenderFont(FONT_PATH);
  const fallback = resolveRenderFont("/definitely/missing/NotoSans-Regular.ttf");
  assert.equal(embedded.resolvedFamily, "Noto Sans (embedded server asset)");
  assert.equal(embedded.fallbackUsed, false);
  assert.equal(productionPath.fontfile, FONT_PATH);
  assert.equal(productionPath.fallbackUsed, false);
  assert.equal(fallback.resolvedFamily, "Pango sans-serif fallback");
  assert.equal(fallback.fallbackUsed, true);
  const output = completeOutput();
  const hero = await generateNativeHero(output.article, {
    heroTitle: output.heroTitle,
    altText: output.heroAltText,
    layoutVariant: "alternative",
  });
  assert.equal(hero.diagnostics.resolvedFontFamily, embedded.resolvedFamily);
  assert.match(hero.svg, /data-layout-element="title" href="data:image\/png;base64/);
  assert.ok(hero.diagnostics.calculatedTextBoundingBox.width > 0);
});

test("SVG structure rejects clipping paths and mismatched viewBoxes", () => {
  const valid = '<svg viewBox="0 0 1600 900"><image data-layout-element="title"/></svg>';
  assert.equal(validateSvgStructure(valid).passed, true);
  const clipped = '<svg viewBox="0 0 1600 900"><clipPath id="title-clip"/></svg>';
  assert.ok(validateSvgStructure(clipped).issues.some(
    (issue) => issue.code === "title-clipping-structure-detected",
  ));
  const wrongCanvas = '<svg viewBox="0 0 1599 900"></svg>';
  assert.ok(validateSvgStructure(wrongCanvas).issues.some(
    (issue) => issue.code === "svg-viewbox-mismatch",
  ));
});

test("post-render QA validates dimensions and title pixels in master and mobile", async () => {
  const output = completeOutput();
  const hero = await generateNativeHero(output.article, {
    heroTitle: output.heroTitle,
    altText: output.heroAltText,
    layoutVariant: "alternative",
  });
  assert.deepEqual(hero.diagnostics.renderedPngDimensions, { width: 1600, height: 900 });
  assert.deepEqual(hero.diagnostics.mobilePngDimensions, { width: 390, height: 219 });
  assert.ok(hero.diagnostics.postRender.titlePixelCounts.master > 0);
  assert.ok(hero.diagnostics.postRender.titlePixelCounts.mobile > 0);
  assert.equal(hero.layoutValidation.postRender.passed, true);
});

test("post-render QA fails when master passes but the mobile title disappears", async () => {
  const output = completeOutput();
  const prepared = await resolveRenderedLayout(output.article, {
    heroTitle: output.heroTitle,
    layoutVariant: "alternative",
  });
  const rendered = renderNativeHeroSvg(output.article, prepared);
  const sharp = require("sharp");
  const png = await sharp(Buffer.from(rendered.svg)).png().toBuffer();
  const blankMobile = await sharp({
    create: {
      width: 390,
      height: 219,
      channels: 3,
      background: "#fbf7ef",
    },
  }).png().toBuffer();
  const result = await validatePostRender({
    svg: rendered.svg,
    png,
    mobilePng: blankMobile,
    layout: prepared.layout,
    titleRaster: prepared.titleRaster,
  });
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "mobile-title-pixels-missing"));
  assert.ok(!result.issues.some((issue) => issue.code === "master-title-pixels-missing"));
});

test("standard failure reaches a guaranteed-safe text-only fallback", async () => {
  const output = completeOutput();
  const longTitle = "Manage Every Subscription Easily Without Linking Your Bank";
  await assert.rejects(
    generateNativeHero(output.article, {
      heroTitle: longTitle,
      layoutVariant: "standard",
    }),
    /Native hero layout failed/,
  );
  const fallback = await generateNativeHero(output.article, {
    heroTitle: "Review Subscriptions Without Bank Links",
    layoutVariant: "minimal",
  });
  assert.equal(fallback.layoutVariant, "minimal");
  assert.equal(fallback.layoutValidation.passed, true);
  assert.equal(fallback.layoutValidation.titleLineCount, 2);
  assert.ok(fallback.layoutValidation.mobileTitleFontSize >= 32);
  assert.ok(fallback.layoutValidation.titleContrast >= 7);
  assert.equal(fallback.diagnostics.titleBackground, "#ffffff");
  assert.doesNotMatch(fallback.svg, /data-layout-element="illustration"/);
  assert.doesNotMatch(fallback.svg, /<(?:clipPath|mask)\b/i);
});

function passingVisionReview(overrides = {}) {
  return {
    score: 96,
    issues: [],
    recommendedFixes: [],
    clipping: false,
    overlap: false,
    mobileReadable: true,
    contrastReadable: true,
    brandVisible: true,
    model: "configured-openai-model",
    ...overrides,
  };
}

function fakeRenderedHero(options) {
  return {
    png: Buffer.from("master"),
    mobilePng: Buffer.from("mobile"),
    svg: "<svg/>",
    layoutVariant: options.layoutVariant,
    heroTitle: options.heroTitle,
    layoutValidation: { passed: true },
  };
}

test("failed vision review retries and never returns the failed image", async () => {
  const output = completeOutput();
  let reviews = 0;
  const result = await generateHeroWithQualityGate({
    article: output.article,
    heroTitle: output.heroTitle,
    altText: output.heroAltText,
    render: async (_article, options) => fakeRenderedHero(options),
    reviewVision: async () => {
      reviews += 1;
      return passingVisionReview({
        score: 82,
        issues: [{ severity: "critical", category: "overlap", message: "Title overlaps art." }],
        overlap: true,
      });
    },
  });
  assert.equal(reviews, 3);
  assert.equal(result.hero, null);
  assert.equal(result.imageReviewRequired, true);
  assert.equal(result.qa.attemptCount, 3);
  assert.equal(result.qa.passed, false);
  assert.equal(result.qa.deterministicPassed, true);
});

test("hero quality gate succeeds on retry with a shorter alternative layout", async () => {
  const output = completeOutput();
  const rendered = [];
  let reviews = 0;
  const result = await generateHeroWithQualityGate({
    article: output.article,
    heroTitle: "How to Review Every UK Subscription Before Your Next Payday",
    altText: output.heroAltText,
    render: async (_article, options) => {
      rendered.push(options);
      return fakeRenderedHero(options);
    },
    reviewVision: async () => {
      reviews += 1;
      return reviews === 1
        ? passingVisionReview({ score: 86, clipping: true })
        : passingVisionReview();
    },
  });
  assert.equal(result.imageReviewRequired, false);
  assert.equal(result.qa.passed, true);
  assert.equal(result.qa.attemptCount, 2);
  assert.equal(result.qa.finalLayoutVariant, "alternative");
  assert.equal(result.qa.deterministicPassed, true);
  assert.ok(rendered[1].heroTitle.length <= 52);
});

test("final hero fallback emails the article without attaching a failed image", async () => {
  const output = completeOutput();
  const result = await generateHeroWithQualityGate({
    article: output.article,
    heroTitle: output.heroTitle,
    altText: output.heroAltText,
    render: async (_article, options) => fakeRenderedHero(options),
    reviewVision: async () => {
      throw new Error("Vision unavailable");
    },
  });
  assert.equal(result.hero, null);
  assert.equal(result.imageReviewRequired, true);
  const engine = read("lib/seoArticles/engine.server.js");
  assert.match(engine, /const approvedImage = imageQa\.passed === true/);
  assert.match(engine, /\.\.\.\(attachments\.length \? \{ attachments \} : \{\}\)/);
  assert.match(engine, /Image review required/);
});

test("OpenAI hero vision QA uses strict structured output and production pass criteria", () => {
  const openai = read("lib/seoArticles/openai.server.js");
  const quality = read("lib/seoArticles/heroQuality.cjs");
  assert.match(openai, /name: "cleartill_hero_image_qa"/);
  assert.match(openai, /strict: true/);
  assert.equal((openai.match(/type: "input_image"/g) || []).length, 2);
  assert.match(openai, /clipping/);
  assert.match(openai, /overlap/);
  assert.match(openai, /mobileReadable/);
  assert.match(openai, /mobileTitleFontSize of at least 28px/);
  assert.match(openai, /titleContrast of at least 7:1/);
  assert.match(quality, /Number\(review\?\.score\) >= 90/);
  assert.match(quality, /issue\.severity === "critical"/);
  assert.match(quality, /review\?\.clipping === false/);
  assert.match(quality, /review\?\.overlap === false/);
  assert.match(quality, /review\?\.mobileReadable === true/);
});

test("hero reprocessing is POST-only, idempotent, preserves article history, and cannot publish", () => {
  const route = read("app/api/admin/seo-articles/rerender-hero/route.js");
  const engine = read("lib/seoArticles/engine.server.js");
  const start = engine.indexOf("export async function reprocessSeoArticleHero");
  const end = engine.indexOf("async function readSignedReview", start);
  const reprocess = engine.slice(start, end);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /confirmProjectId/);
  assert.match(route, /confirmNoPublish/);
  assert.match(engine, /seoArticleHeroReprocessRuns/);
  assert.match(reprocess, /seo-hero-rereview-\$\{id\}-\$\{HERO_REPROCESS_REVISION\}/);
  assert.match(reprocess, /emailStatus: hero \? "sent" : "skipped"/);
  assert.match(reprocess, /const delivery = hero[\s\S]*\? await sendEmail/);
  assert.match(reprocess, /\["sent", "skipped"\]\.includes\(current\?\.emailStatus\)/);
  assert.match(reprocess, /heroImage: replacementImage/);
  assert.doesNotMatch(reprocess, /transaction\.update\(draftRef,\s*\{[^}]*\b(?:article|claims|sources|status|reviewedAt)\s*:/s);
  assert.doesNotMatch(reprocess, /\bpublication\s*:/);
  assert.match(reprocess, /published: false/);
  assert.match(engine, /subject: `Corrected hero image ready for review:/);
});

test("hero-only title generation uses a strict 45–60 character schema", () => {
  const openai = read("lib/seoArticles/openai.server.js");
  assert.match(openai, /name: "cleartill_hero_title"/);
  assert.match(openai, /HERO_TITLE_SCHEMA/);
  assert.match(openai, /minLength: 45, maxLength: 60/);
  assert.match(openai, /preserve the article meaning/);
});

test("production Firebase workflow is Admin-only and secrets stay server-side", () => {
  const engine = read("lib/seoArticles/engine.server.js");
  const scheduler = read("app/api/scheduler/seo-articles/route.js");
  const canvaRoute = read("app/api/admin/seo-articles/canva/route.js");
  assert.match(engine, /getAdminDb/);
  assert.ok(!engine.includes("firebase/firestore"));
  assert.doesNotMatch(engine, /NEXT_PUBLIC_(?:SEO|OPENAI|CANVA)/);
  assert.match(scheduler, /authorization/);
  assert.match(scheduler, /SCHEDULER_SECRET|CRON_SECRET/);
  assert.match(canvaRoute, /verifyAnalyticsAdminRequest/);
});

test("SEO and Canva adapters contain no Autofill API call", () => {
  const sources = [
    read("lib/seoArticles/engine.server.js"),
    read("lib/integrations/canva.server.js"),
  ].join("\n");
  assert.equal(/\/autofills?(?:\b|\/)/i.test(sources), false);
});

test("SEO runtime configuration reuses an explicit existing model and fails closed", () => {
  const complete = getSeoArticleRuntimeConfig({
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "existing-cleartill-model",
    SEO_REVIEW_EMAIL_TO: "review@example.test",
    SEO_REVIEW_TOKEN_SECRET: "review-secret",
    RESEND_API_KEY: "resend-key",
    SCHEDULER_SECRET: "scheduler-secret",
    FIREBASE_PROJECT_ID: "cleartill-staging",
    FIREBASE_ADMIN_CLIENT_EMAIL: "firebase@example.test",
    FIREBASE_ADMIN_PRIVATE_KEY: "private-key",
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.values.model, "existing-cleartill-model");

  const missing = getSeoArticleRuntimeConfig({});
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("SEO_ARTICLE_OPENAI_MODEL or OPENAI_MODEL"));
  assert.ok(missing.missing.includes("FIREBASE_PROJECT_ID"));

  const openaiAdapter = read("lib/seoArticles/openai.server.js");
  assert.doesNotMatch(openaiAdapter, /gpt-5\.6-terra/);
  assert.match(openaiAdapter, /config\.model/);
  assert.doesNotMatch(openaiAdapter, /reasoning:\s*\{\s*effort/);
});

test("manual dry-run is confirmed, POST-only, idempotent, and never scheduled", () => {
  const route = read("app/api/admin/seo-articles/dry-run/route.js");
  const scheduler = read("app/api/scheduler/seo-articles/route.js");
  const vercel = JSON.parse(read("vercel.json"));
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /confirmProjectId/);
  assert.match(route, /confirmNoPublish/);
  assert.match(route, /SEO_DRY_RUN_SECRET/);
  assert.match(route, /runScheduledSeoArticle/);
  assert.match(route, /publicationActivated: false/);
  assert.match(scheduler, /requires an authorised POST request/);
  assert.equal(vercel.crons.some((cron) => cron.path.includes("seo-articles")), false);

  const engine = read("lib/seoArticles/engine.server.js");
  assert.match(engine, /requireSeoArticleRuntimeConfig/);
  assert.match(engine, /idempotencyKey: `seo-review-\$\{draft\.runId\}`/);
  assert.match(engine, /duplicatePrevented/);
});
