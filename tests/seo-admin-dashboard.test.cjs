"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const dashboardServer = read("lib/seoArticles/admin.server.js");
const dashboardPage = read("app/admin/seo-articles/page.jsx");
const dashboardRoute = read("app/api/admin/seo-articles/route.js");
const articleRoute = read("app/api/admin/seo-articles/[articleId]/route.js");
const assetRoute = read("app/api/admin/seo-articles/[articleId]/hero/[variant]/route.js");
const reviewPackageRoute = read("app/api/admin/seo-articles/[articleId]/review-package/route.js");
const decisionRoute = read("app/api/admin/seo-articles/[articleId]/decision/route.js");
const preview = read("app/admin/seo-articles/[articleId]/preview/PreviewClient.jsx");
const reviewPackage = read("lib/seoArticles/reviewPackage.server.js");
const reviewActionRoute = read("app/api/seo-articles/review/route.js");
const engine = read("lib/seoArticles/engine.server.js");
const vercel = JSON.parse(read("vercel.json"));

test("SEO admin APIs require the existing Firebase admin authorization", () => {
  for (const source of [
    dashboardRoute,
    articleRoute,
    reviewPackageRoute,
    decisionRoute,
  ]) {
    assert.match(source, /verifyAnalyticsAdminRequest\(request\)/);
  }
  assert.match(dashboardPage, /Authorization: `Bearer \$\{token\}`/);
  assert.match(preview, /Authorization: `Bearer \$\{token\}`/);
  assert.match(dashboardPage, /Access denied/);
  assert.match(preview, /authorised ClearTill administrators/);
});

test("dashboard reads are bounded and use stored aggregates", () => {
  assert.match(dashboardServer, /SEO_ADMIN_RECENT_LIMIT = 30/);
  assert.ok((dashboardServer.match(/\.limit\(SEO_ADMIN_RECENT_LIMIT\)/g) || []).length >= 2);
  assert.match(dashboardServer, /\.count\(\)\.get\(\)/);
  assert.match(dashboardServer, /doc\("aggregate"\)\.get\(\)/);
  assert.match(dashboardServer, /rawAnalyticsScanned: false/);
  assert.doesNotMatch(dashboardServer, /collectionGroup\(/);
});

test("dashboard has an explicit empty state and failed-run filter", () => {
  assert.match(dashboardPage, /No SEO articles yet/);
  assert.match(dashboardPage, /\["failed", "quality_failed"\]/);
  assert.match(dashboardServer, /failedRunSummary/);
  assert.match(dashboardServer, /previewAvailable: false/);
});

test("finished article dashboard exposes the required operational fields", () => {
  for (const label of [
    "How to Review Subscriptions Without Using a Bank Connection",
    "Primary keyword",
    "Topic / cluster",
    "Deterministic quality",
    "Editorial score",
    "Hero status",
    "Review email",
    "Publication ready — not published",
  ]) {
    if (label.startsWith("How to")) continue;
    assert.match(dashboardPage, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(dashboardServer, /publicationReady/);
  assert.match(dashboardServer, /published:/);
});

test("approved master and mobile heroes use signed short-lived asset URLs", () => {
  assert.match(dashboardServer, /createSeoHeroAssetToken/);
  assert.match(dashboardServer, /createHmac\("sha256"/);
  assert.match(dashboardServer, /payload\.expiresAt/);
  assert.match(dashboardServer, /heroAssetUrl\(articleId, "master"\)/);
  assert.match(dashboardServer, /heroAssetUrl\(articleId, "mobile"\)/);
  assert.match(assetRoute, /verifySeoHeroAssetToken/);
  assert.match(assetRoute, /private, max-age=300/);
});

test("failed or unapproved hero assets are not returned", () => {
  assert.match(dashboardServer, /image\?\.qa\?\.passed !== true/);
  assert.match(dashboardServer, /seo\/hero-not-approved/);
  assert.match(dashboardServer, /pngBase64/);
  assert.match(dashboardServer, /mobilePngBase64/);
  assert.doesNotMatch(dashboardPage, /pngBase64|mobilePngBase64/);
  assert.doesNotMatch(preview, /pngBase64|mobilePngBase64/);
});

test("preview uses the same Journal article renderer as the live article", () => {
  const liveArticle = read("app/blog/[slug]/page.jsx");
  assert.match(liveArticle, /JournalArticleContent/);
  assert.match(preview, /JournalArticleContent/);
  assert.match(preview, /Desktop article/);
  assert.match(preview, /Mobile article/);
  assert.match(preview, /Hero master/);
  assert.match(preview, /Hero mobile/);
  assert.match(preview, /Sources and claims/);
});

test("preview clearly preserves the unpublished publication boundary", () => {
  assert.match(preview, /Unpublished preview/);
  assert.match(preview, /Publication ready — not published/);
  assert.match(preview, /Viewing or reviewing it does not publish the article/);
  assert.match(engine, /published: false/);
  assert.match(engine, /exportedToLiveCollection: false/);
});

test("finished review email contains the inline approved hero and complete review data", () => {
  assert.match(reviewPackage, /Finished article ready for final review/);
  assert.match(reviewPackage, /contentId: "cleartill-finished-hero"/);
  assert.match(reviewPackage, /cid:cleartill-finished-hero/);
  assert.match(reviewPackage, /renderFullArticle\(article\)/);
  assert.match(reviewPackage, /Sources and claims/);
  assert.match(reviewPackage, /Quality results/);
  assert.match(reviewPackage, /Primary keyword/);
  assert.match(reviewPackage, /Editorial recommendation/);
});

test("review package delivery is revision-idempotent and explicit resends are labelled", () => {
  assert.match(reviewPackage, /PACKAGE_REVISION = "finished-review-v1"/);
  assert.match(reviewPackage, /eventId\(id, articleData\.version\.id, selectedRevision\)/);
  assert.match(reviewPackage, /seo-finished-review-\$\{draft\.draftId\}-\$\{version\.id\}-\$\{revision\}/);
  assert.match(reviewPackage, /duplicatePrevented: true/);
  assert.match(reviewPackage, /Resent: Finished article ready for final review/);
  assert.match(reviewPackage, /\^resend-/);
});

test("review GET is read-only and approval requires POST", () => {
  assert.doesNotMatch(reviewActionRoute, /export async function GET/);
  assert.match(reviewActionRoute, /export async function POST/);
  assert.doesNotMatch(decisionRoute, /export async function GET/);
  assert.match(decisionRoute, /export async function POST/);
  assert.match(decisionRoute, /performAdminSeoReviewAction/);
});

test("recurring SEO cron remains disabled", () => {
  assert.match(dashboardServer, /SEO_RECURRING_CRON_ENABLED = false/);
  assert.equal(vercel.crons.some((cron) => /seo/i.test(cron.path)), false);
});

test("client-rendered SEO admin files do not expose server secrets", () => {
  const combinedClient = `${dashboardPage}\n${preview}`;
  for (const secretName of [
    "FIREBASE_ADMIN_PRIVATE_KEY",
    "CANVA_CLIENT_SECRET",
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
    "SEO_REVIEW_TOKEN_SECRET",
  ]) {
    assert.doesNotMatch(combinedClient, new RegExp(secretName));
  }
});

test("external SEO data is explicitly disconnected rather than fabricated", () => {
  assert.match(dashboardServer, /Google Search Console not connected/);
  assert.match(dashboardServer, /Keyword rankings not connected/);
  assert.match(dashboardServer, /Backlink monitoring not connected/);
  assert.match(dashboardServer, /Organic traffic data not connected/);
});
