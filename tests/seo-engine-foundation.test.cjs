const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("SEO cron is approval-gated and protected", () => {
  const route = read("app/api/cron/seo-draft/route.js");
  assert.match(route, /assertSeoCronAuthorised/);
  assert.match(route, /SEO engine is disabled/);
  assert.match(route, /mode: "draft-only"/);
  assert.match(route, /autoPublishEnabled: false/);
  assert.doesNotMatch(route, /publishArticle\s*\(/);
});

test("SEO engine defaults to disabled and limits daily drafts", () => {
  const config = read("lib/seo-engine/config.js");
  assert.match(config, /enabled: false/);
  assert.match(config, /autoPublishEnabled: false/);
  assert.match(config, /min: 1, max: 3/);
  assert.match(config, /CRON_SECRET/);
});

test("quality gates reject unsupported claims and unsourced material facts", () => {
  const quality = read("lib/seo-engine/quality-gates.js");
  assert.match(quality, /BANNED_CLAIM_PATTERNS/);
  assert.match(quality, /Material factual claims require at least one source record/);
  assert.match(quality, /Slug already exists/);
  assert.match(quality, /prohibitedClaimsAbsent/);
});

test("seed backlog prioritises product-fit topics", () => {
  const topics = read("lib/seo-engine/seed-topics.js");
  assert.match(topics, /safe-to-spend-before-payday/);
  assert.match(topics, /productFitScore: 100/);
  assert.match(topics, /selectNextSeedTopic/);
});
