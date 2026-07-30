"use strict";

const LAYOUT_ATTEMPTS = [
  { variant: "standard", maxTitleLength: 60 },
  { variant: "alternative", maxTitleLength: 52 },
  { variant: "minimal", maxTitleLength: 48, guaranteedSafe: true },
];

function shortenHeroTitle(value, maxLength) {
  const original = String(value || "").trim();
  if (original.length <= maxLength) return original;
  const withoutPrefix = original.replace(
    /^(?:how to|a practical guide to|a guide to|understanding)\s+/i,
    "",
  );
  const candidate = withoutPrefix.length >= 32 ? withoutPrefix : original;
  const words = candidate.split(/\s+/);
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxLength) break;
    result = next;
  }
  if (result.length >= 24) return result;
  return `${candidate.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function guaranteedSafeTitle(article, heroTitle, maxLength) {
  const articleTitle = String(article?.title || "");
  if (/subscriptions?/i.test(articleTitle) && /bank/i.test(articleTitle)) {
    return "Review Subscriptions Without Bank Links";
  }
  return shortenHeroTitle(heroTitle || articleTitle, maxLength);
}

function normalizeIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => ({
    severity: ["critical", "major", "minor"].includes(issue?.severity)
      ? issue.severity
      : "major",
    category: String(issue?.category || issue?.code || "visual_quality"),
    message: String(issue?.message || "Visual quality issue detected."),
  }));
}

function visionReviewPassed(review) {
  const issues = normalizeIssues(review?.issues);
  return Number(review?.score) >= 90
    && !issues.some((issue) => issue.severity === "critical")
    && review?.clipping === false
    && review?.overlap === false
    && review?.mobileReadable === true;
}

function qaRecord(review, {
  attemptCount,
  layoutVariant,
  reviewedAt,
  fallbackModel = null,
} = {}) {
  const issues = normalizeIssues(review?.issues);
  return {
    passed: visionReviewPassed({ ...review, issues }),
    visionScore: Number.isFinite(Number(review?.score)) ? Number(review.score) : 0,
    issues,
    recommendedFixes: Array.isArray(review?.recommendedFixes)
      ? review.recommendedFixes.map(String)
      : [],
    model: review?.model || fallbackModel,
    usage: review?.usage || null,
    attemptCount,
    finalLayoutVariant: layoutVariant,
    reviewedAt,
    clipping: review?.clipping !== false,
    overlap: review?.overlap !== false,
    mobileReadable: review?.mobileReadable === true,
    contrastReadable: review?.contrastReadable === true,
    brandVisible: review?.brandVisible === true,
    deterministicPassed: review?.deterministicPassed === true,
  };
}

async function generateHeroWithQualityGate({
  article,
  heroTitle,
  altText,
  render,
  reviewVision,
  now = () => new Date(),
  attempts = LAYOUT_ATTEMPTS,
} = {}) {
  if (typeof render !== "function" || typeof reviewVision !== "function") {
    throw new TypeError("Hero quality gate requires render and reviewVision functions.");
  }
  let finalQa = null;
  const attemptDiagnostics = [];
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const attemptCount = index + 1;
    const displayTitle = attempt.guaranteedSafe
      ? guaranteedSafeTitle(article, heroTitle, attempt.maxTitleLength)
      : shortenHeroTitle(heroTitle, attempt.maxTitleLength);
    let hero;
    try {
      hero = await render(article, {
        heroTitle: displayTitle,
        altText,
        layoutVariant: attempt.variant,
      });
    } catch (error) {
      attemptDiagnostics.push({
        attemptCount,
        layoutVariant: attempt.variant,
        attemptedHeroTitle: displayTitle,
        deterministicPassed: false,
        ...(error?.renderDiagnostics || {}),
        visionScore: null,
        visionIssues: [],
      });
      finalQa = qaRecord({
        score: 0,
        issues: error?.layoutIssues || [{
          severity: "critical",
          category: "rendering",
          message: error?.message || "Hero rendering failed.",
        }],
        recommendedFixes: ["Use a shorter hero title and an alternative layout."],
        clipping: true,
        overlap: true,
        mobileReadable: false,
        contrastReadable: false,
        brandVisible: false,
        deterministicPassed: false,
      }, {
        attemptCount,
        layoutVariant: attempt.variant,
        reviewedAt: now().toISOString(),
        fallbackModel: "deterministic-layout-v1",
      });
      continue;
    }
    try {
      const review = await reviewVision({
        masterPng: hero.png,
        mobilePng: hero.mobilePng,
        heroTitle: displayTitle,
        layoutVariant: attempt.variant,
        renderDiagnostics: hero.diagnostics,
      });
      attemptDiagnostics.push({
        attemptCount,
        layoutVariant: attempt.variant,
        attemptedHeroTitle: displayTitle,
        deterministicPassed: hero?.layoutValidation?.passed === true,
        ...(hero.diagnostics || {}),
        visionScore: review?.score ?? null,
        visionIssues: normalizeIssues(review?.issues),
        visionUsage: review?.usage || null,
      });
      finalQa = qaRecord({
        ...review,
        deterministicPassed: hero?.layoutValidation?.passed === true,
      }, {
        attemptCount,
        layoutVariant: attempt.variant,
        reviewedAt: now().toISOString(),
      });
    } catch (error) {
      attemptDiagnostics.push({
        attemptCount,
        layoutVariant: attempt.variant,
        attemptedHeroTitle: displayTitle,
        deterministicPassed: hero?.layoutValidation?.passed === true,
        ...(hero?.diagnostics || {}),
        visionScore: null,
        visionIssues: [{
          severity: "critical",
          category: "vision_review",
          message: "Automated image review could not be completed.",
        }],
      });
      finalQa = qaRecord({
        score: 0,
        issues: [{
          severity: "critical",
          category: "vision_review",
          message: "Automated image review could not be completed.",
        }],
        recommendedFixes: ["Complete a manual image review before publication."],
        clipping: true,
        overlap: true,
        mobileReadable: false,
        contrastReadable: false,
        brandVisible: false,
        deterministicPassed: hero?.layoutValidation?.passed === true,
        model: error?.model || null,
      }, {
        attemptCount,
        layoutVariant: attempt.variant,
        reviewedAt: now().toISOString(),
      });
    }
    if (finalQa.passed) {
      finalQa.attemptDiagnostics = attemptDiagnostics;
      return {
        hero,
        qa: finalQa,
        imageReviewRequired: false,
      };
    }
  }
  if (finalQa) finalQa.attemptDiagnostics = attemptDiagnostics;
  return {
    hero: null,
    qa: finalQa || qaRecord({}, {
      attemptCount: attempts.length,
      layoutVariant: attempts.at(-1)?.variant || null,
      reviewedAt: now().toISOString(),
    }),
    imageReviewRequired: true,
  };
}

module.exports = {
  LAYOUT_ATTEMPTS,
  generateHeroWithQualityGate,
  normalizeIssues,
  qaRecord,
  guaranteedSafeTitle,
  shortenHeroTitle,
  visionReviewPassed,
};
