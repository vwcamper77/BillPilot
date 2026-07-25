const BANNED_CLAIM_PATTERNS = [
  /\bguaranteed\b/i,
  /\brisk[- ]free\b/i,
  /\bfinancial advice\b/i,
  /\byou should invest\b/i,
  /\byou should borrow\b/i,
  /\bbest (?:bank|loan|credit card|investment)\b/i,
  /\bcheapest (?:bank|loan|credit card)\b/i,
];

const MATERIAL_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?%\b/,
  /£\s?\d[\d,]*(?:\.\d{1,2})?/,
  /\b(?:average|median|majority|most|research shows|study shows|according to)\b/i,
];

function flattenArticleText(article) {
  const content = Array.isArray(article?.content) ? article.content : [];
  const contentText = content
    .flatMap((block) => {
      const values = [block?.text, block?.label, block?.formula, block?.caption];
      if (Array.isArray(block?.items)) values.push(JSON.stringify(block.items));
      if (Array.isArray(block?.rows)) values.push(JSON.stringify(block.rows));
      if (Array.isArray(block?.segments)) values.push(JSON.stringify(block.segments));
      return values;
    })
    .filter(Boolean)
    .join(" ");

  return [
    article?.title,
    article?.seoTitle,
    article?.description,
    article?.takeaway,
    contentText,
    JSON.stringify(article?.faqs || []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function runDeterministicQualityGates({ article, citations = [], existingSlugs = [] }) {
  const errors = [];
  const warnings = [];
  const text = flattenArticleText(article);

  if (!article || article.type !== "article") errors.push("Article type must be 'article'.");
  if (!article?.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
    errors.push("Slug must be lowercase kebab-case.");
  }
  if (existingSlugs.includes(article?.slug)) errors.push("Slug already exists.");
  if (!article?.title || article.title.length < 20) errors.push("Title is missing or too short.");
  if (!article?.description || article.description.length < 70) {
    errors.push("Meta description must be at least 70 characters.");
  }
  if (!Array.isArray(article?.content) || article.content.length < 5) {
    errors.push("Article must contain at least five structured content blocks.");
  }

  for (const pattern of BANNED_CLAIM_PATTERNS) {
    if (pattern.test(text)) errors.push(`Unsupported or prohibited claim detected: ${pattern}`);
  }

  const hasMaterialClaim = MATERIAL_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
  if (hasMaterialClaim && citations.length === 0) {
    errors.push("Material factual claims require at least one source record.");
  }

  const promotionalMentions = (text.match(/ClearTill/gi) || []).length;
  if (promotionalMentions > 4) warnings.push("ClearTill is mentioned more than four times.");

  const score = Math.max(0, 100 - errors.length * 25 - warnings.length * 5);
  return {
    passed: errors.length === 0,
    score,
    errors,
    warnings,
    checks: {
      validArticleType: article?.type === "article",
      uniqueSlug: Boolean(article?.slug) && !existingSlugs.includes(article.slug),
      structuredContent: Array.isArray(article?.content) && article.content.length >= 5,
      materialClaimsSourced: !hasMaterialClaim || citations.length > 0,
      prohibitedClaimsAbsent: !BANNED_CLAIM_PATTERNS.some((pattern) => pattern.test(text)),
    },
  };
}
