import generation from "@/lib/seoArticles/articleGeneration.cjs";
import runtimeConfig from "@/lib/seoArticles/runtimeConfig.cjs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const HERO_VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "issues",
    "recommendedFixes",
    "clipping",
    "overlap",
    "mobileReadable",
    "contrastReadable",
    "brandVisible",
  ],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "message"],
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: {
            type: "string",
            enum: [
              "clipping",
              "overlap",
              "alignment",
              "readability",
              "contrast",
              "brand_visibility",
              "mobile_legibility",
            ],
          },
          message: { type: "string" },
        },
      },
    },
    recommendedFixes: { type: "array", items: { type: "string" } },
    clipping: { type: "boolean" },
    overlap: { type: "boolean" },
    mobileReadable: { type: "boolean" },
    contrastReadable: { type: "boolean" },
    brandVisible: { type: "boolean" },
  },
};
const HERO_TITLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["heroTitle"],
  properties: {
    heroTitle: { type: "string", minLength: 45, maxLength: 60 },
  },
};
const EDITORIAL_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "recommendation", "comments"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    recommendation: {
      type: "string",
      enum: ["approve", "approve_with_minor_changes", "request_changes", "reject"],
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "message", "resolved"],
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: {
            type: "string",
            enum: ["accuracy", "claims", "clarity", "structure", "tone", "seo", "cta", "internal_links"],
          },
          message: { type: "string" },
          resolved: { type: "boolean" },
        },
      },
    },
  },
};
const DEFAULT_TOPICS = [
  "How to plan direct debits around payday in the UK",
  "How to build a realistic bills buffer on a UK income",
  "What to include when working out money left until payday",
  "How irregular income changes short-term cashflow planning",
  "How to review subscriptions without using a bank connection",
];

function topicForDate(dateKey) {
  const configured = String(process.env.SEO_ARTICLE_TOPICS || "")
    .split("|")
    .map((topic) => topic.trim())
    .filter(Boolean);
  const topics = configured.length ? configured : DEFAULT_TOPICS;
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  return topics[Math.abs(day) % topics.length];
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function responseUsage(payload) {
  const usage = payload?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

export async function generateStructuredSeoArticle({
  dateKey,
  topic = topicForDate(dateKey),
  brief = null,
  fetchImpl = fetch,
}) {
  const config = runtimeConfig.requireSeoArticleRuntimeConfig();
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      input: [
        {
          role: "system",
          content: [
            "You are the ClearTill Journal research and drafting engine.",
            "Research current, authoritative UK sources with web search before writing.",
            "Write a complete, useful UK-focused guide in plain English.",
            "Do not provide personalised financial advice or claim money is safe to spend.",
            "ClearTill uses manual user-entered figures and does not connect to a bank.",
            "Every material factual claim must have a claim record linked bidirectionally to at least one source record.",
            "Prefer GOV.UK, MoneyHelper, regulators, charities, and primary sources.",
            "Do not invent URLs, statistics, endorsements, customers, or product capabilities.",
            "The disclaimer must contain both exact phrases: 'not personalised financial advice' and 'estimates based on the figures entered'.",
            "Return heroTitle as a distinct, concise 45–60 character display title; preserve the complete search-focused title in article.title.",
            "Use heading blocks with an id and text; paragraph blocks with text; list blocks with items. Keep unused text/items fields empty.",
            "When a planning brief is supplied, follow its primary keyword, search intent, audience, CTA and approved internal-link targets without inventing claims.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Scheduled date: ${dateKey}. Topic: ${topic}.`,
            brief ? `Approved planning brief: ${JSON.stringify({
              primaryKeyword: brief.primaryKeyword,
              secondaryKeywords: brief.secondaryKeywords,
              searchIntent: brief.searchIntent,
              audience: brief.audience,
              articleType: brief.articleType,
              proposedCta: brief.proposedCta,
              proposedInternalLinks: brief.proposedInternalLinks,
              supportingAssetRequirement: brief.supportingAssetRequirement,
            })}.` : "",
            "Produce exactly one complete article draft with its claims, sources, and hero alt text.",
          ].filter(Boolean).join(" "),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cleartill_seo_article",
          strict: true,
          schema: generation.ARTICLE_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI article generation failed with status ${response.status}.`,
    );
  }
  let value;
  try {
    value = JSON.parse(responseText(payload));
  } catch {
    throw new Error("OpenAI returned invalid structured article JSON.");
  }
  const validation = generation.validateStructuredArticleOutput(value);
  if (!validation.valid) {
    throw new Error(`OpenAI structured article validation failed: ${validation.errors.join(" ")}`);
  }
  return {
    ...value,
    generation: {
      provider: "openai",
      responseId: payload.id || null,
      model: payload.model || config.model,
      topic,
      dateKey,
      brief: brief ? {
        primaryKeyword: brief.primaryKeyword || null,
        searchIntent: brief.searchIntent || null,
        articleType: brief.articleType || null,
      } : null,
      usage: responseUsage(payload),
    },
  };
}

export async function reviewSeoHeroVision({
  masterPng,
  mobilePng,
  heroTitle,
  layoutVariant,
  renderDiagnostics,
  fetchImpl = fetch,
}) {
  const config = runtimeConfig.requireSeoArticleRuntimeConfig();
  if (!Buffer.isBuffer(masterPng) || !Buffer.isBuffer(mobilePng)) {
    throw new TypeError("Hero vision review requires master and mobile PNG buffers.");
  }
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Act as a strict production image QA reviewer.",
              "The first image is the 1600x900 master; the second is its 390px-wide mobile preview.",
              `Display title: ${heroTitle}. Layout variant: ${layoutVariant}.`,
              `Deterministic renderer diagnostics: ${JSON.stringify({
                resolvedFontFamily: renderDiagnostics?.resolvedFontFamily || null,
                fontSize: renderDiagnostics?.fontSize || null,
                mobileTitleFontSize: renderDiagnostics?.mobileTitleFontSize || null,
                calculatedTextBoundingBox: renderDiagnostics?.calculatedTextBoundingBox || null,
                titleAreaBoundingBox: renderDiagnostics?.titleAreaBoundingBox || null,
                masterDimensions: renderDiagnostics?.renderedPngDimensions || null,
                mobileDimensions: renderDiagnostics?.mobilePngDimensions || null,
                titlePixelCounts: renderDiagnostics?.postRender?.titlePixelCounts || null,
                titleContrast: renderDiagnostics?.titleContrast || null,
                titleForeground: renderDiagnostics?.titleForeground || null,
                titleBackground: renderDiagnostics?.titleBackground || null,
              })}.`,
              "Assess clipping, overlap, alignment, readability, contrast, ClearTill brand visibility, and mobile legibility.",
              "Judge whether the title is visibly present and readable; do not fail it merely because OCR omits a word or the title wraps across lines.",
              "Treat the supplied deterministic measurements as authoritative unless the image visibly contradicts them.",
              "A mobileTitleFontSize of at least 28px with passing mobile title-pixel validation is comfortably readable; do not mark it unreadable for font size alone.",
              "A measured titleContrast of at least 7:1 is enhanced contrast; do not report low contrast unless visible raster corruption contradicts that measurement.",
              "Assess the article title separately from deliberately small footer branding.",
              "Separate blocking production faults from minor aesthetic suggestions. Minor imbalance alone must not make clipping, overlap, contrast, or mobile readability fail.",
              "Any clipped or overlapping text is critical. Mark mobileReadable false if the title cannot be read comfortably at the supplied mobile size.",
              "Score 90 or higher only when the image is production-ready with no critical issues.",
            ].join(" "),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${masterPng.toString("base64")}`,
            detail: "high",
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${mobilePng.toString("base64")}`,
            detail: "high",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "cleartill_hero_image_qa",
          strict: true,
          schema: HERO_VISION_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || `OpenAI hero review failed with status ${response.status}.`,
    );
    error.model = config.model;
    throw error;
  }
  let result;
  try {
    result = JSON.parse(responseText(payload));
  } catch {
    const error = new Error("OpenAI returned invalid structured hero review JSON.");
    error.model = payload?.model || config.model;
    throw error;
  }
  if (
    !Number.isInteger(result?.score)
    || !Array.isArray(result?.issues)
    || !Array.isArray(result?.recommendedFixes)
    || typeof result?.clipping !== "boolean"
    || typeof result?.overlap !== "boolean"
    || typeof result?.mobileReadable !== "boolean"
  ) {
    const error = new Error("OpenAI returned an incomplete structured hero review.");
    error.model = payload?.model || config.model;
    throw error;
  }
  return {
    ...result,
    model: payload?.model || config.model,
    usage: responseUsage(payload),
  };
}

export async function generateSeoHeroTitle({
  article,
  fetchImpl = fetch,
}) {
  const config = runtimeConfig.requireSeoArticleRuntimeConfig();
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [{
        role: "user",
        content: [
          "Create one concise display title for a ClearTill Journal hero image.",
          "Return 45–60 characters, use plain UK English, preserve the article meaning, and do not add claims.",
          `Full article title: ${article?.title || ""}`,
          `Description: ${article?.description || ""}`,
        ].join(" "),
      }],
      text: {
        format: {
          type: "json_schema",
          name: "cleartill_hero_title",
          strict: true,
          schema: HERO_TITLE_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI hero title generation failed with status ${response.status}.`,
    );
  }
  let result;
  try {
    result = JSON.parse(responseText(payload));
  } catch {
    throw new Error("OpenAI returned invalid structured hero title JSON.");
  }
  const heroTitle = String(result?.heroTitle || "").trim();
  if (heroTitle.length < 45 || heroTitle.length > 60) {
    throw new Error("OpenAI hero title must contain 45–60 characters.");
  }
  return {
    heroTitle,
    model: payload?.model || config.model,
    responseId: payload?.id || null,
    usage: responseUsage(payload),
  };
}

export async function reviewIndependentSeoArticle({
  article,
  claims,
  sources,
  qualityReport,
  fetchImpl = fetch,
}) {
  const config = runtimeConfig.requireSeoArticleRuntimeConfig();
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [{
        role: "user",
        content: [
          "Act as an independent ClearTill Journal editor using UK English.",
          "Review accuracy, claim support, clarity, structure, tone, search intent, CTA and internal links.",
          "Treat any unsupported material claim, misleading money-safety wording or invented product capability as critical.",
          "Do not rewrite the article. Return only the strict editorial review.",
          JSON.stringify({ article, claims, sources, deterministicQuality: qualityReport }),
        ].join("\n"),
      }],
      text: {
        format: {
          type: "json_schema",
          name: "cleartill_seo_editorial_review",
          strict: true,
          schema: EDITORIAL_REVIEW_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI editorial review failed with status ${response.status}.`,
    );
  }
  let result;
  try {
    result = JSON.parse(responseText(payload));
  } catch {
    throw new Error("OpenAI returned invalid structured editorial review JSON.");
  }
  if (
    !Number.isInteger(result?.score)
    || !Array.isArray(result?.comments)
    || !["approve", "approve_with_minor_changes", "request_changes", "reject"].includes(result?.recommendation)
  ) {
    throw new Error("OpenAI returned an incomplete editorial review.");
  }
  return {
    ...result,
    model: payload?.model || config.model,
    responseId: payload?.id || null,
    usage: responseUsage(payload),
    reviewedAt: new Date().toISOString(),
  };
}

export {
  EDITORIAL_REVIEW_SCHEMA,
  HERO_TITLE_SCHEMA,
  HERO_VISION_SCHEMA,
  responseUsage,
  topicForDate,
};
