"use strict";

const { assertArticleInput } = require("./articleCore.cjs");
const { JournalDraftAdapter, validateJournalDraft } = require("../marketing/JournalDraftAdapter");
const CLAIMS_POLICY = require("../../marketing/brand/claims-policy.json");
const PRODUCT_FACTS = require("../../marketing/brand/product-facts.json");

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["article", "claims", "sources", "heroTitle", "heroAltText"],
  properties: {
    article: {
      type: "object",
      additionalProperties: false,
      required: [
        "type", "slug", "title", "seoTitle", "description", "keywords", "category",
        "readingMinutes", "takeaway", "disclaimer", "content",
      ],
      properties: {
        type: { type: "string", const: "article" },
        slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        title: { type: "string", minLength: 20, maxLength: 120 },
        seoTitle: { type: "string", minLength: 20, maxLength: 70 },
        description: { type: "string", minLength: 80, maxLength: 170 },
        keywords: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
        category: {
          type: "string",
          enum: ["money-basics", "bills-and-payday", "spending-and-saving"],
        },
        readingMinutes: { type: "integer", minimum: 4, maximum: 12 },
        takeaway: { type: "string", minLength: 40, maxLength: 300 },
        disclaimer: { type: "string", minLength: 40, maxLength: 300 },
        content: {
          type: "array",
          minItems: 10,
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "id", "text", "items", "claimIds"],
            properties: {
              type: { type: "string", enum: ["heading", "paragraph", "list"] },
              id: { type: "string" },
              text: { type: "string" },
              items: { type: "array", items: { type: "string" } },
              claimIds: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "material", "sourceIds"],
        properties: {
          id: { type: "string" },
          statement: { type: "string", minLength: 10 },
          material: { type: "boolean" },
          sourceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "title", "url", "publisher", "publishedAt", "accessedAt", "claimIds",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          publishedAt: { type: ["string", "null"] },
          accessedAt: { type: "string" },
          claimIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    heroTitle: { type: "string", minLength: 45, maxLength: 60 },
    heroAltText: { type: "string", minLength: 30, maxLength: 220 },
  },
};

function flattenStrings(value, result = []) {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, result));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => flattenStrings(item, result));
  }
  return result;
}

function validateStructuredArticleOutput(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["Structured output must be an object."] };
  }
  try {
    assertArticleInput(value.article);
  } catch (error) {
    errors.push(error.message);
  }
  if (value.article?.type !== "article") errors.push('article.type must be "article".');
  if (!Array.isArray(value.claims) || value.claims.length === 0) {
    errors.push("At least one claim record is required.");
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    errors.push("At least one source record is required.");
  }
  const claims = new Map((value.claims || []).map((claim) => [claim.id, claim]));
  const sources = new Map((value.sources || []).map((source) => [source.id, source]));
  if (claims.size !== (value.claims || []).length) errors.push("Claim IDs must be unique.");
  if (sources.size !== (value.sources || []).length) errors.push("Source IDs must be unique.");

  for (const source of value.sources || []) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") errors.push(`Source ${source.id} must use HTTPS.`);
    } catch {
      errors.push(`Source ${source.id || "unknown"} has an invalid URL.`);
    }
    if (!source.title || !source.publisher || !source.accessedAt) {
      errors.push(`Source ${source.id || "unknown"} is incomplete.`);
    }
    for (const claimId of source.claimIds || []) {
      if (!claims.has(claimId)) errors.push(`Source ${source.id} references unknown claim ${claimId}.`);
    }
  }
  for (const claim of value.claims || []) {
    if (!claim.id || !String(claim.statement || "").trim() || typeof claim.material !== "boolean") {
      errors.push("Every claim record requires an id, statement, and material boolean.");
    }
    if (!Array.isArray(claim.sourceIds) || claim.sourceIds.length === 0) {
      errors.push(`${claim.material === true ? "Material claim" : "Claim"} ${claim.id} has no source.`);
    }
    for (const sourceId of claim.sourceIds || []) {
      const source = sources.get(sourceId);
      if (!source) errors.push(`Claim ${claim.id} references unknown source ${sourceId}.`);
      else if (!(source.claimIds || []).includes(claim.id)) {
        errors.push(`Claim ${claim.id} and source ${sourceId} are not linked both ways.`);
      }
    }
  }
  for (const block of value.article?.content || []) {
    if (!["heading", "paragraph", "list"].includes(block.type)) {
      errors.push(`Unsupported article block type: ${block.type || "missing"}.`);
    }
    if (block.type === "heading" && (!block.id || !block.text)) {
      errors.push("Article headings require an id and text.");
    }
    if (block.type === "paragraph" && !block.text) {
      errors.push("Article paragraphs require text.");
    }
    if (block.type === "list" && (!Array.isArray(block.items) || block.items.length === 0)) {
      errors.push("Article lists require items.");
    }
    for (const claimId of block.claimIds || []) {
      if (!claims.has(claimId)) errors.push(`Article block references unknown claim ${claimId}.`);
    }
  }
  const heroTitle = String(value.heroTitle || "").trim();
  if (heroTitle.length < 45 || heroTitle.length > 60) {
    errors.push("Hero title must be between 45 and 60 characters.");
  }
  if (!String(value.heroAltText || "").trim()) errors.push("Hero alt text is required.");
  return { valid: errors.length === 0, errors };
}

function runDeterministicQualityGates(value, { contentId = "seo-generated" } = {}) {
  const errors = [...validateStructuredArticleOutput(value).errors];
  const allText = flattenStrings(value.article || {}).join(" ");
  const normalized = allText.toLowerCase();
  for (const pattern of CLAIMS_POLICY.unsupportedClaimPatterns || []) {
    if (normalized.includes(pattern.toLowerCase())) {
      errors.push(`Unsupported claim detected: ${pattern}.`);
    }
  }
  for (const pattern of CLAIMS_POLICY.testimonialPatterns || []) {
    if (normalized.includes(pattern.toLowerCase())) {
      errors.push(`Invented testimonial pattern detected: ${pattern}.`);
    }
  }
  if (!/\b(?:uk|britain|british|£|payday|council tax|direct debit)\b/i.test(allText)) {
    errors.push("Article must be explicitly relevant to a UK audience.");
  }
  for (const disclosure of [
    "not personalised financial advice",
    "estimates based on the figures entered",
  ]) {
    if (!normalized.includes(disclosure)) errors.push(`Missing required disclosure: ${disclosure}.`);
  }

  try {
    const record = new JournalDraftAdapter().create({
      contentId,
      article: value.article,
      heroImage: {
        visualBrief: "ClearTill-native deterministic editorial hero.",
        expectedCanvaExportFilename: `${value.article?.slug || "article"}-hero.png`,
        altText: value.heroAltText,
      },
      hypothesis: "A sourced UK-focused guide will earn qualified organic discovery.",
      primaryMeasurementGoal: "Qualified Journal visits and preview starts.",
      campaign: { source: "seo-article-engine" },
    });
    errors.push(...validateJournalDraft(record).errors);
  } catch (error) {
    errors.push(error.message);
  }
  return {
    passed: errors.length === 0,
    errors: [...new Set(errors)],
    checks: {
      structuredOutput: validateStructuredArticleOutput(value).valid,
      materialClaimsSourced: !errors.some((error) => /claim .* no source|unknown source|linked both ways/i.test(error)),
      claimsPolicy: !errors.some((error) => /Unsupported claim|testimonial/.test(error)),
      ukFocus: !errors.some((error) => /UK audience/.test(error)),
      requiredDisclosures: !errors.some((error) => /required disclosure/.test(error)),
      existingJournalDraftGate: !errors.some((error) => /^Journal|Draft article/.test(error)),
    },
    productFactsVersion: PRODUCT_FACTS.verifiedAt,
  };
}

module.exports = {
  ARTICLE_SCHEMA,
  runDeterministicQualityGates,
  validateStructuredArticleOutput,
};
