"use strict";

const PIPELINE_STATES = Object.freeze([
  "planned",
  "research_ready",
  "generating",
  "generation_failed",
  "review_ready",
  "changes_requested",
  "approved",
  "scheduled",
  "publication_ready",
  "publishing",
  "published",
  "distribution_ready",
  "buffer_idea_created",
  "buffer_scheduled",
  "promoted",
  "measurement_pending",
  "refresh_due",
  "archived",
  "rejected",
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  planned: ["research_ready", "archived"],
  research_ready: ["generating", "planned", "archived"],
  generating: ["review_ready", "generation_failed"],
  generation_failed: ["research_ready", "archived"],
  review_ready: ["changes_requested", "approved", "rejected"],
  changes_requested: ["generating", "rejected", "archived"],
  approved: ["scheduled", "publication_ready", "changes_requested"],
  scheduled: ["publication_ready", "approved", "archived"],
  publication_ready: ["publishing", "approved"],
  publishing: ["published", "publication_ready"],
  published: ["distribution_ready", "archived"],
  distribution_ready: ["buffer_idea_created", "buffer_scheduled", "measurement_pending"],
  buffer_idea_created: ["buffer_scheduled", "measurement_pending"],
  buffer_scheduled: ["promoted", "distribution_ready"],
  promoted: ["measurement_pending", "refresh_due"],
  measurement_pending: ["refresh_due", "archived"],
  refresh_due: ["research_ready", "archived"],
  archived: ["planned"],
  rejected: ["planned", "archived"],
});

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: "cleartill-seo-settings-v1",
  batchSize: 3,
  maxProvisionalTitleLength: 90,
  articlesPerWeek: 3,
  publicationWeekdays: [1, 3, 5],
  publicationTime: "09:30",
  timezone: "Europe/London",
  annualPlanStartDate: "2026-08-03",
  categoryTargets: {
    clear_to_spend: 30,
    bills_direct_debits_subscriptions: 26,
    irregular_income: 18,
    seasonal_life_events: 24,
    calculators_templates_tools: 16,
    privacy_trust_product: 11,
    adaptive: 31,
  },
  adaptiveSlotPercentage: 19.87,
  generationEnabled: false,
  publicationAutomationEnabled: false,
  bufferSyncEnabled: false,
  selectedBufferOrganisationId: null,
  selectedBufferChannelIds: [],
  socialPostTimingOffsetsDays: [0, 4, 28],
  approvalRequirements: {
    deterministicPassed: true,
    criticalEditorialIssuesResolved: true,
    heroQaPassed: true,
    sourcesRequired: true,
  },
  minimumArticleScore: 90,
  minimumEditorialScore: 90,
  minimumHeroScore: 90,
});

function validateSettings(input = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input,
    approvalRequirements: {
      ...DEFAULT_SETTINGS.approvalRequirements,
      ...(input.approvalRequirements || {}),
    },
  };
  if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 10) {
    throw new TypeError("Batch size must be between 1 and 10.");
  }
  if (
    !Number.isInteger(settings.maxProvisionalTitleLength)
    || settings.maxProvisionalTitleLength < 45
    || settings.maxProvisionalTitleLength > 120
  ) {
    throw new TypeError("Maximum provisional title length must be between 45 and 120 characters.");
  }
  if (settings.articlesPerWeek !== 3) {
    throw new TypeError("The current operating plan requires three articles per week.");
  }
  if (settings.timezone !== "Europe/London") {
    throw new TypeError("ClearTill SEO scheduling must use Europe/London.");
  }
  if (
    settings.publicationWeekdays.length !== 3
    || new Set(settings.publicationWeekdays).size !== 3
  ) {
    throw new TypeError("Choose exactly three publication weekdays.");
  }
  return settings;
}

function transitionRecord({
  entityId,
  previousStatus,
  newStatus,
  actor,
  articleId = null,
  versionId = null,
  safeReason = "",
  sourceAction,
  timestamp = new Date().toISOString(),
}) {
  if (!PIPELINE_STATES.includes(previousStatus) || !PIPELINE_STATES.includes(newStatus)) {
    throw new TypeError("Unknown SEO pipeline status.");
  }
  if (
    previousStatus !== newStatus
    && !(ALLOWED_TRANSITIONS[previousStatus] || []).includes(newStatus)
  ) {
    throw new Error(`SEO pipeline transition ${previousStatus} → ${newStatus} is not allowed.`);
  }
  return {
    entityId: String(entityId),
    previousStatus,
    newStatus,
    actor: {
      uid: String(actor?.uid || ""),
      email: String(actor?.email || "").toLowerCase(),
    },
    timestamp,
    articleId: articleId ? String(articleId) : null,
    versionId: versionId ? String(versionId) : null,
    safeReason: String(safeReason || "").trim().slice(0, 500) || null,
    sourceAction: String(sourceAction || "").trim().slice(0, 100),
  };
}

function reviewEligibility(article, settings = DEFAULT_SETTINGS) {
  const checks = Object.values(article?.qualityReport?.checks || {});
  const criticalEditorialIssues = (article?.editorial?.comments || []).filter((comment) => (
    String(comment?.severity || "").toLowerCase() === "critical"
    && comment?.resolved !== true
  ));
  const sourceCount = Number(article?.sourceCount ?? article?.sources?.length ?? 0);
  const articleScore = Number(article?.qualityScore ?? (
    checks.length ? (checks.filter(Boolean).length / checks.length) * 100 : 0
  ));
  const reasons = [];
  if (!["review_ready", "in_review"].includes(article?.currentStatus)) {
    reasons.push("The article must return to review-ready status before approval.");
  }
  if (settings.approvalRequirements.deterministicPassed && (
    !checks.length || checks.some((passed) => passed !== true)
  )) reasons.push("Deterministic quality gates have not all passed.");
  if (
    settings.approvalRequirements.criticalEditorialIssuesResolved
    && criticalEditorialIssues.length
  ) reasons.push("Critical editorial comments remain unresolved.");
  if (
    settings.approvalRequirements.heroQaPassed
    && article?.hero?.approved !== true
    && article?.heroQaPassed !== true
  ) reasons.push("Hero QA has not passed.");
  if (settings.approvalRequirements.sourcesRequired && sourceCount < 1) {
    reasons.push("At least one claim source is required.");
  }
  if (articleScore < settings.minimumArticleScore) {
    reasons.push(`Article score is below ${settings.minimumArticleScore}.`);
  }
  if (
    article?.editorialScore === null
    || article?.editorialScore === undefined
    || !Number.isFinite(Number(article.editorialScore))
  ) {
    reasons.push("Independent editorial review is missing.");
  } else if (Number(article.editorialScore) < settings.minimumEditorialScore) {
    reasons.push(`Editorial score is below ${settings.minimumEditorialScore}.`);
  }
  if (
    Number(article?.heroScore ?? article?.hero?.score ?? 0) < settings.minimumHeroScore
  ) reasons.push(`Hero score is below ${settings.minimumHeroScore}.`);
  if (article?.duplicateRisk?.passed === false) {
    reasons.push("A keyword or search-intent cannibalisation warning remains.");
  }
  return { eligible: reasons.length === 0, reasons };
}

function selectGenerationBatch(calendarItems, {
  batchSize = DEFAULT_SETTINGS.batchSize,
  existingArticles = [],
  duplicateCheck,
  maxTitleLength = DEFAULT_SETTINGS.maxProvisionalTitleLength,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
    throw new TypeError("Batch size must be between 1 and 10.");
  }
  const eligible = [];
  const excluded = [];
  for (const item of [...(calendarItems || [])].sort((left, right) => (
    String(left.proposedPublicationDate).localeCompare(String(right.proposedPublicationDate))
  ))) {
    if (!["planned", "research_ready", "generation_failed"].includes(item.status)) {
      excluded.push({ calendarItemId: item.calendarItemId, reason: "status" });
      continue;
    }
    if (
      item.evergreenOrAdaptive === "adaptive"
      && (
        !String(item.adaptiveEvidence || "").trim()
        || !String(item.provisionalTitle || "").trim()
        || !String(item.primaryKeyword || "").trim()
      )
    ) {
      excluded.push({ calendarItemId: item.calendarItemId, reason: "adaptive_unassigned" });
      continue;
    }
    const topic = validateGenerationBatch([item], {
      existingArticles: [...existingArticles, ...eligible],
      duplicateCheck,
      maxTitleLength,
      enforceCategoryDiversity: false,
    });
    if (!topic.passed) {
      excluded.push({
        calendarItemId: item.calendarItemId,
        reason: "topic_validation",
        validation: topic,
      });
      continue;
    }
    const risk = typeof duplicateCheck === "function"
      ? duplicateCheck(item, [...existingArticles, ...eligible])
      : { passed: true };
    if (!risk.passed) {
      excluded.push({ calendarItemId: item.calendarItemId, reason: "duplicate", risk });
      continue;
    }
    eligible.push({ ...item, duplicateRisk: risk });
    if (eligible.length === batchSize) break;
  }
  return {
    batchSize,
    selected: eligible,
    excluded,
    validation: validateGenerationBatch(eligible, {
      existingArticles,
      duplicateCheck,
      maxTitleLength,
    }),
  };
}

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function minimumCategories(batchSize) {
  if (batchSize >= 10) return 4;
  if (batchSize >= 3) return 2;
  return 1;
}

function validateGenerationBatch(items, {
  existingArticles = [],
  duplicateCheck,
  maxTitleLength = DEFAULT_SETTINGS.maxProvisionalTitleLength,
  enforceCategoryDiversity = true,
} = {}) {
  const selected = items || [];
  const issues = [];
  const keywords = new Map();
  const titles = new Map();
  const intents = new Map();
  const accepted = [];
  for (const item of selected) {
    const id = item.calendarItemId || item.id || "unknown";
    const title = String(item.provisionalTitle || "").trim();
    const keyword = normalized(item.primaryKeyword);
    const intent = normalized(item.searchIntent);
    const theme = normalized(item.seasonalRelevance);
    const adaptive = item.evergreenOrAdaptive === "adaptive";
    if (!title || !keyword || !intent) {
      issues.push({ code: "topic_incomplete", calendarItemId: id });
    }
    if (title.length > maxTitleLength) {
      issues.push({
        code: "title_too_long",
        calendarItemId: id,
        maximum: maxTitleLength,
      });
    }
    if (
      /^adaptive opportunity\s*:/i.test(title)
      || (theme && normalized(title).includes(theme))
    ) {
      issues.push({ code: "planning_metadata_in_title", calendarItemId: id });
    }
    if (adaptive && !String(item.adaptiveEvidence || "").trim()) {
      issues.push({ code: "adaptive_evidence_missing", calendarItemId: id });
    }
    for (const [map, value, code] of [
      [keywords, keyword, "duplicate_primary_keyword"],
      [titles, normalized(title), "duplicate_title"],
      [intents, intent, "duplicate_search_intent"],
    ]) {
      if (!value) continue;
      if (map.has(value)) {
        issues.push({
          code,
          calendarItemId: id,
          duplicateOf: map.get(value),
        });
      } else {
        map.set(value, id);
      }
    }
    const risk = typeof duplicateCheck === "function"
      ? duplicateCheck(item, [...existingArticles, ...accepted])
      : { passed: true };
    if (!risk.passed) {
      issues.push({
        code: "content_overlap",
        calendarItemId: id,
        risk,
      });
    }
    accepted.push(item);
  }
  const categoryCount = new Set(
    selected.map((item) => item.category).filter(Boolean),
  ).size;
  const requiredCategories = enforceCategoryDiversity
    ? minimumCategories(selected.length)
    : 1;
  if (selected.length && categoryCount < requiredCategories) {
    issues.push({
      code: "category_diversity",
      categoryCount,
      requiredCategories,
    });
  }
  return {
    passed: issues.length === 0,
    issues,
    selectedCount: selected.length,
    categoryCount,
    requiredCategories,
    maxTitleLength,
  };
}

function buildGenerationJobSpecs(batchId, selectedItems) {
  const id = String(batchId || "").trim();
  const selected = selectedItems || [];
  if (!id) throw new TypeError("A generation batch ID is required.");
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 10) {
    throw new TypeError("Generation batches must contain between 1 and 10 selected topics.");
  }
  return selected.map((item, index) => ({
    jobId: `${id}-${String(index + 1).padStart(2, "0")}`,
    batchId: id,
    calendarItemId: item.calendarItemId,
    brief: item,
    position: index,
    status: "queued",
    attempts: 0,
  }));
}

function assignNextPublicationSlots(articles, calendarItems, {
  limit = 10,
} = {}) {
  const selected = (articles || []).slice(0, limit);
  const slots = (calendarItems || [])
    .filter((item) => (
      ["planned", "research_ready"].includes(item.status)
      && !item.articleId
    ))
    .sort((left, right) => (
      String(left.proposedPublicationDate).localeCompare(String(right.proposedPublicationDate))
    ))
    .slice(0, selected.length);
  if (slots.length !== selected.length) {
    throw new Error("There are not enough empty publication slots.");
  }
  return selected.map((article, index) => ({
    articleId: article.id || article.articleId,
    versionId: article.versionId || article.version?.id,
    calendarItemId: slots[index].calendarItemId,
    scheduledFor: slots[index].proposedPublicationDate,
    timezone: slots[index].timezone || "Europe/London",
  }));
}

function validateReschedule(calendarItems, calendarItemId, proposedDate, {
  articlesPerWeek = 3,
} = {}) {
  const item = (calendarItems || []).find((entry) => entry.calendarItemId === calendarItemId);
  if (!item) return { valid: false, reason: "Calendar item not found." };
  const occupied = (calendarItems || []).find((entry) => (
    entry.calendarItemId !== calendarItemId
    && entry.proposedPublicationDate === proposedDate
  ));
  if (occupied) return { valid: false, reason: "That publication slot is already occupied." };
  const date = new Date(`${String(proposedDate).slice(0, 10)}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  const monday = date.toISOString().slice(0, 10);
  const weekCount = (calendarItems || []).filter((entry) => {
    if (entry.calendarItemId === calendarItemId) return false;
    const current = new Date(`${String(entry.proposedPublicationDate).slice(0, 10)}T12:00:00Z`);
    const currentDay = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() - currentDay + 1);
    return current.toISOString().slice(0, 10) === monday;
  }).length;
  if (weekCount >= articlesPerWeek) {
    return { valid: false, reason: "That week already has three publication slots." };
  }
  return { valid: true, reason: null, item: { ...item, proposedPublicationDate: proposedDate } };
}

module.exports = {
  ALLOWED_TRANSITIONS,
  DEFAULT_SETTINGS,
  PIPELINE_STATES,
  assignNextPublicationSlots,
  buildGenerationJobSpecs,
  reviewEligibility,
  selectGenerationBatch,
  transitionRecord,
  validateGenerationBatch,
  validateReschedule,
  validateSettings,
};
