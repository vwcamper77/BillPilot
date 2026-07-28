"use strict";

const ARTICLE_FIELDS = ["slug", "title", "seoTitle", "description", "category", "readingMinutes", "takeaway", "content"];
const APPROVAL_CHECKS = ["copyApproved", "claimsChecked", "productFactsChecked", "licenceChecked", "linksChecked", "visualChecked", "scheduleChecked", "humanApproved"];

function validateJournalDraft(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return { valid: false, errors: ["Journal draft must be an object."] };
  if (record.schemaVersion !== "journal-draft-v1") errors.push("Journal draft requires schemaVersion journal-draft-v1.");
  if (!["draft", "published"].includes(record.status)) errors.push('Journal record status must be "draft" or "published".');
  if (!record.contentId) errors.push("Journal draft requires contentId.");
  const isPublished = record.status === "published";
  if (!isPublished && record.publication?.publishedAt !== null) errors.push("Journal draft publication.publishedAt must be null.");
  if (!isPublished && record.publication?.exportedToLiveCollection !== false) errors.push("Journal draft must explicitly remain outside the live collection.");
  if (isPublished && !record.publication?.publishedAt) errors.push("Published Journal record requires publication.publishedAt.");
  if (isPublished && record.publication?.exportedToLiveCollection !== true) errors.push("Published Journal record must be exported to the live collection.");

  const article = record.article || {};
  if (article.type !== "article") errors.push('Journal draft article requires type "article".');
  if (Object.hasOwn(article, "publishedAt")) errors.push("Draft article must not define publishedAt.");
  for (const field of ARTICLE_FIELDS) {
    const value = article[field];
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) errors.push(`Draft article requires ${field}.`);
  }
  if (!Number.isInteger(article.readingMinutes) || article.readingMinutes < 1) errors.push("Draft article requires a positive integer readingMinutes value.");
  if (!Array.isArray(article.content) || article.content.length === 0) errors.push("Draft article requires non-empty content.");
  if (!record.heroImage?.visualBrief?.trim()) errors.push("Journal draft requires a hero-image visual brief.");
  if (!record.heroImage?.expectedCanvaExportFilename?.trim()) errors.push("Journal draft requires an expected Canva export filename.");
  if (!record.heroImage?.altText?.trim()) errors.push("Journal draft requires hero-image alt text.");
  for (const calculation of record.illustrativeCalculations || []) {
    const start = Number(calculation.start);
    const deductions = Array.isArray(calculation.deductions) ? calculation.deductions.map(Number) : [];
    const result = Number(calculation.result);
    const deductionTotal = deductions.reduce((sum, value) => sum + value, 0);
    if (![start, result, ...deductions].every(Number.isFinite) || Math.abs(start - deductionTotal - result) > 0.000001) {
      errors.push(`Invalid illustrative calculation: ${calculation.label || "unnamed"}.`);
    }
    if (calculation.totalDeductions != null && Number(calculation.totalDeductions) !== deductionTotal) {
      errors.push(`Invalid illustrative deduction total: ${calculation.label || "unnamed"}.`);
    }
  }
  for (const check of APPROVAL_CHECKS) {
    if (record.approvalChecks?.[check] !== isPublished) errors.push(`Journal ${check} must be ${isPublished} for status ${record.status}.`);
  }
  if (!isPublished && (record.approval?.approvedBy !== null || record.approval?.approvedAt !== null)) errors.push("Journal draft approval must remain empty.");
  if (isPublished && (!record.approval?.approvedBy || !record.approval?.approvedAt)) errors.push("Published Journal record requires approval attribution.");
  return { valid: errors.length === 0, errors };
}

class JournalDraftAdapter {
  create({ contentId, article, heroImage, hypothesis, primaryMeasurementGoal, campaign, illustrativeCalculations = [] }) {
    const record = {
      schemaVersion: "journal-draft-v1",
      contentId,
      status: "draft",
      hypothesis,
      primaryMeasurementGoal,
      campaign,
      illustrativeCalculations,
      article: { ...article },
      heroImage: { ...heroImage },
      approvalChecks: Object.fromEntries(APPROVAL_CHECKS.map((check) => [check, false])),
      approval: { approvedBy: null, approvedAt: null },
      publication: { publishedAt: null, exportedToLiveCollection: false },
    };
    const validation = validateJournalDraft(record);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    return record;
  }
}

module.exports = { APPROVAL_CHECKS, JournalDraftAdapter, validateJournalDraft };
