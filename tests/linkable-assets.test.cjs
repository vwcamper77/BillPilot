const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sitemap includes the calculator and guide but no future report", () => {
  const sitemap = read("app/sitemap.js");
  const posts = read("app/blog/posts.js");
  assert.match(posts, /budgeting-without-open-banking/);
  assert.match(posts, /payday-cashflow-calculator/);
  assert.match(sitemap, /JOURNAL_TOOLS/);
  assert.doesNotMatch(`${sitemap}\n${posts}`, /uk-payday-pressure-report-2026/);
  assert.doesNotMatch(sitemap, /\/billing/);
  assert.match(sitemap, /\/about-cleartill/);
  assert.doesNotMatch(sitemap, /url:.*\/about["`]/);
});

test("robots allows public tools while retaining private-route protections", () => {
  const robots = read("app/robots.js");
  assert.match(robots, /"\/tools\/"/);
  for (const route of ["/api/", "/admin/", "/account/", "/dashboard/", "/access/", "/billing/", "/trial/", "/signin", "/start", "/unsubscribe"]) {
    assert.ok(robots.includes(`"${route}"`), `missing robots protection for ${route}`);
  }
});

test("calculator and guide expose unique canonical metadata inputs", () => {
  const calculator = read("app/tools/payday-cashflow-calculator/page.jsx");
  const schema = read("lib/linkableAssetsSchema.js");
  const posts = read("app/blog/posts.js");
  assert.match(schema, /PAYDAY_CALCULATOR_PATH = "\/tools\/payday-cashflow-calculator"/);
  assert.match(calculator, /createPageMetadata/);
  assert.match(posts, /slug: "budgeting-without-open-banking"/);
  assert.match(posts, /seoTitle: "Budgeting Without Open Banking: A Practical UK Guide"/);
});

test("calculator does not persist, transmit or track entered financial values", () => {
  const calculator = read("app/tools/payday-cashflow-calculator/PaydayCashflowCalculator.jsx");
  assert.doesNotMatch(calculator, /localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|trackClientAnalyticsEvent|trackEvent|URLSearchParams|history\./);
  for (const field of ["availableCash", "nextIncomeDate"]) {
    assert.match(calculator, new RegExp(field));
  }
  assert.doesNotMatch(calculator, /confirmedIncome|billsDueBeforeDate|oneOffCosts|safetyBuffer/);
});

test("homepage links directly to the free payday calculator", () => {
  const homepage = read("app/page.jsx");
  assert.match(homepage, /href="\/tools\/payday-cashflow-calculator"/);
});

test("structured data contains no ratings, reviews or fabricated usage claims", () => {
  const files = [
    "lib/linkableAssetsSchema.js",
    "app/tools/payday-cashflow-calculator/page.jsx",
    "app/blog/[slug]/page.jsx",
  ].map(read).join("\n");
  assert.doesNotMatch(files, /AggregateRating|ratingValue|numberOfUsers|award:/);
  assert.doesNotMatch(files, /"@type": "Review"/);
  const schema = read("lib/linkableAssetsSchema.js");
  assert.equal((schema.match(/"@type": "WebApplication"/g) || []).length, 1);
  assert.equal((schema.match(/"@type": "BreadcrumbList"/g) || []).length, 1);
});

test("Journal content types include articles and a separate validated tool record", () => {
  const posts = read("app/blog/posts.js");
  const blog = read("app/blog/page.jsx");
  assert.match(posts, /type: "article"/);
  assert.match(posts, /type: "tool"/);
  assert.match(posts, /validateJournalContent\(\)/);
  assert.match(posts, /article-only field/);
  assert.match(blog, /Free tools/);
  assert.match(blog, /\?topic=\$\{category\.slug\}/);
  assert.match(blog, /BLOG_POSTS\.filter\(\(post\) => post\.category === activeCategory\)/);
});
