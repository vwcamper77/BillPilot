"use strict";

function publicationActionKey({
  articleId,
  versionId,
  action,
  calendarItemId = "",
  scheduledFor = "",
  idempotencyKey = "",
}) {
  return [
    String(articleId),
    String(versionId),
    String(action),
    String(calendarItemId),
    String(scheduledFor),
    String(idempotencyKey),
  ].join(":");
}

function validatePublicationCandidate({
  draft,
  publicationExport,
  versionId,
  existingSlug,
  now = new Date(),
} = {}) {
  const errors = [];
  if (!draft || !publicationExport) errors.push("Approved export not found.");
  const currentVersion = `v${Math.max(
    1,
    Number(
      publicationExport?.version
      || publicationExport?.versionNumber
      || draft?.currentVersion
      || draft?.version
      || 1,
    ) || 1,
  )}`;
  if (versionId !== currentVersion) errors.push("The requested article version is stale.");
  const approvedStatuses = new Set([
    "approved",
    "scheduled",
    "publication_ready",
    "published",
    "distribution_ready",
    "archived",
  ]);
  if (
    publicationExport?.status !== "publication_ready"
    || !approvedStatuses.has(draft?.status)
  ) errors.push("The article has not been approved for publication.");
  if (Object.values(publicationExport?.qualityReport?.checks || {}).some((value) => value !== true)) {
    errors.push("Deterministic quality gates have not all passed.");
  }
  if (!(publicationExport?.sources || []).length) errors.push("Publication sources are missing.");
  if (publicationExport?.heroImage?.qa?.passed !== true) errors.push("Approved hero QA is missing.");
  if (!publicationExport?.article?.slug) errors.push("A unique article slug is required.");
  if (
    existingSlug
    && (
      existingSlug.articleId !== draft?.draftId
      || existingSlug.versionId !== currentVersion
    )
  ) errors.push("The Journal slug is already in use.");
  return {
    valid: errors.length === 0,
    errors,
    currentVersion,
    checkedAt: now.toISOString(),
  };
}

function publicArticleSnapshot({
  draft,
  publicationExport,
  versionId,
  publishedAt,
  actor,
}) {
  return {
    schemaVersion: "cleartill-public-journal-v1",
    articleId: draft.draftId,
    versionId,
    slug: publicationExport.article.slug,
    article: structuredClone(publicationExport.article),
    claims: structuredClone(publicationExport.claims || []),
    sources: structuredClone(publicationExport.sources || []),
    qualityReport: structuredClone(publicationExport.qualityReport || {}),
    hero: {
      alt: publicationExport.heroImage.alt,
      heroTitle: publicationExport.heroImage.heroTitle,
      width: publicationExport.heroImage.width,
      height: publicationExport.heroImage.height,
      mobileWidth: publicationExport.heroImage.mobileWidth,
      mobileHeight: publicationExport.heroImage.mobileHeight,
      qa: structuredClone(publicationExport.heroImage.qa),
    },
    published: true,
    publishedAt,
    approvedAt: draft.reviewedAt || null,
    approvedVersionId: versionId,
    createdBy: {
      uid: String(actor?.uid || ""),
      email: String(actor?.email || "").toLowerCase(),
    },
  };
}

module.exports = {
  publicationActionKey,
  publicArticleSnapshot,
  validatePublicationCandidate,
};
