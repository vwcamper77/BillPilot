const crypto = require("node:crypto");

const HERO_WIDTH = 1600;
const HERO_HEIGHT = 900;
const MAX_IMAGE_BYTES = 700_000;
const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function assertArticleInput(article) {
  if (!article || typeof article !== "object" || Array.isArray(article)) {
    throw new TypeError("SEO article must be an object.");
  }
  for (const field of [
    "slug",
    "title",
    "seoTitle",
    "description",
    "category",
    "takeaway",
  ]) {
    if (!String(article[field] || "").trim()) {
      throw new TypeError(`SEO article requires ${field}.`);
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
    throw new TypeError("SEO article slug must use lowercase URL-safe words.");
  }
  if (!Number.isInteger(article.readingMinutes) || article.readingMinutes < 1) {
    throw new TypeError("SEO article requires a positive integer readingMinutes.");
  }
  if (!Array.isArray(article.content) || article.content.length === 0) {
    throw new TypeError("SEO article requires non-empty content.");
  }
  if (Object.hasOwn(article, "publishedAt")) {
    throw new TypeError("SEO article drafts must not define publishedAt.");
  }
  return article;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signReviewToken(payload, secret) {
  if (!String(secret || "").trim()) {
    throw new Error("SEO_REVIEW_TOKEN_SECRET is not configured.");
  }
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(
    crypto.createHmac("sha256", secret).update(encoded).digest(),
  );
  return `${encoded}.${signature}`;
}

function verifyReviewToken(token, secret, now = Date.now()) {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new Error("Invalid SEO review token.");
  }
  const expected = base64Url(
    crypto.createHmac("sha256", String(secret || "")).update(encoded).digest(),
  );
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    supplied.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(supplied, expectedBuffer)
  ) {
    throw new Error("Invalid SEO review token.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid SEO review token.");
  }
  if (!payload?.draftId || !payload?.slug || Number(payload.expiresAt) <= now) {
    throw new Error("SEO review token is invalid or expired.");
  }
  return payload;
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function normalizeCapabilitySnapshot(status, checkedAt = new Date().toISOString()) {
  return {
    available: status?.connected === true,
    workspace: status?.workspace || null,
    capabilities: {
      brand_template: status?.capabilities?.brand_template === true,
      autofill: status?.capabilities?.autofill === true,
      resize: status?.capabilities?.resize === true,
    },
    lastCheckedAt: checkedAt,
    errorCode: status?.errorCode || null,
  };
}

function buildCanvaFallbackPlan(snapshot, { selectedTemplateId = null } = {}) {
  const capabilities = snapshot?.capabilities || {};
  return {
    primaryImageSource: "cleartill_native",
    autofillRequired: false,
    canPublishWithoutCanva: true,
    canvaAvailable: snapshot?.available === true,
    steps: {
      listBrandTemplates: snapshot?.available === true && capabilities.brand_template === true,
      selectedTemplateId,
      createFromBrandTemplate: Boolean(
        selectedTemplateId
        && snapshot?.available === true
        && capabilities.brand_template === true,
      ),
      resize: snapshot?.available === true && capabilities.resize === true,
      export: snapshot?.available === true,
    },
  };
}

module.exports = {
  HERO_HEIGHT,
  HERO_WIDTH,
  MAX_IMAGE_BYTES,
  REVIEW_TTL_MS,
  assertArticleInput,
  buildCanvaFallbackPlan,
  normalizeCapabilitySnapshot,
  signReviewToken,
  tokenDigest,
  verifyReviewToken,
};
