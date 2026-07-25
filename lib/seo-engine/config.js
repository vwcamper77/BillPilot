const DEFAULTS = Object.freeze({
  enabled: false,
  autoPublishEnabled: false,
  dailyDraftLimit: 1,
  minimumOverallScore: 85,
  minimumFactualScore: 95,
  timezone: "Europe/London",
});

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function parseInteger(value, fallback, { min, max }) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getSeoEngineConfig(env = process.env) {
  return Object.freeze({
    enabled: parseBoolean(env.SEO_ENGINE_ENABLED, DEFAULTS.enabled),
    autoPublishEnabled: parseBoolean(
      env.SEO_AUTO_PUBLISH_ENABLED,
      DEFAULTS.autoPublishEnabled,
    ),
    dailyDraftLimit: parseInteger(
      env.SEO_DAILY_DRAFT_LIMIT,
      DEFAULTS.dailyDraftLimit,
      { min: 1, max: 3 },
    ),
    minimumOverallScore: parseInteger(
      env.SEO_MIN_OVERALL_SCORE,
      DEFAULTS.minimumOverallScore,
      { min: 0, max: 100 },
    ),
    minimumFactualScore: parseInteger(
      env.SEO_MIN_FACTUAL_SCORE,
      DEFAULTS.minimumFactualScore,
      { min: 0, max: 100 },
    ),
    model: env.SEO_MODEL || null,
    reviewModel: env.SEO_REVIEW_MODEL || null,
    reviewEmailTo: env.SEO_REVIEW_EMAIL_TO || null,
    reviewEmailFrom: env.SEO_REVIEW_EMAIL_FROM || env.EMAIL_FROM || "ClearTill <hello@cleartill.money>",
    reviewTokenConfigured: String(env.SEO_REVIEW_TOKEN_SECRET || "").trim().length >= 32,
    timezone: DEFAULTS.timezone,
  });
}

export function assertSeoCronAuthorised(request, env = process.env) {
  const expected = env.CRON_SECRET;
  if (!expected) {
    return { authorised: false, reason: "CRON_SECRET is not configured" };
  }

  const supplied = request.headers.get("authorization");
  if (supplied !== `Bearer ${expected}`) {
    return { authorised: false, reason: "Invalid cron credentials" };
  }

  return { authorised: true, reason: null };
}
