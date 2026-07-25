const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("review email uses signed confirmation links and Resend", () => {
  const email = read("lib/seo-engine/review-email.js");
  assert.match(email, /new Resend\(apiKey\)/);
  assert.match(email, /SEO_REVIEW_EMAIL_TO/);
  assert.match(email, /createSeoReviewToken/);
  assert.match(email, /Review and approve/);
  assert.match(email, /Request changes/);
  assert.match(email, /Reject/);
  assert.doesNotMatch(email, /emails\.send\([^)]*autoPublish/i);
});

test("review tokens are signed, time limited and action bound", () => {
  const tokens = read("lib/seo-engine/review-token.js");
  assert.match(tokens, /createHmac\("sha256"/);
  assert.match(tokens, /timingSafeEqual/);
  assert.match(tokens, /SEO_REVIEW_TOKEN_SECRET/);
  assert.match(tokens, /expectedAction/);
  assert.match(tokens, /Expired token/);
});

test("email link cannot mutate a draft with GET", () => {
  const page = read("app/seo-review/[draftId]/page.jsx");
  const route = read("app/api/seo/review/route.js");
  assert.match(page, /method="post"/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /signed_email_confirmation/);
});

test("approval remains separate from publication", () => {
  const route = read("app/api/seo/review/route.js");
  assert.match(route, /approve: "approved"/);
  assert.doesNotMatch(route, /publishArticle\s*\(/);
  assert.match(route, /has not been published automatically/);
});
