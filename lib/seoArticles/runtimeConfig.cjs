"use strict";

function getSeoArticleRuntimeConfig(env = process.env) {
  const model = String(env.SEO_ARTICLE_OPENAI_MODEL || env.OPENAI_MODEL || "").trim();
  const values = {
    openaiApiKey: String(env.OPENAI_API_KEY || "").trim(),
    model,
    reviewerEmail: String(env.SEO_REVIEW_EMAIL_TO || "").trim(),
    reviewTokenSecret: String(env.SEO_REVIEW_TOKEN_SECRET || "").trim(),
    resendApiKey: String(env.RESEND_API_KEY || "").trim(),
    schedulerSecret: String(env.SCHEDULER_SECRET || env.CRON_SECRET || "").trim(),
    firebaseProjectId: String(env.FIREBASE_PROJECT_ID || "").trim(),
    firebaseClientEmail: String(
      env.FIREBASE_ADMIN_CLIENT_EMAIL || env.FIREBASE_CLIENT_EMAIL || "",
    ).trim(),
    firebasePrivateKey: String(
      env.FIREBASE_ADMIN_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY || "",
    ).trim(),
  };
  const missing = [];
  if (!values.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!values.model) missing.push("SEO_ARTICLE_OPENAI_MODEL or OPENAI_MODEL");
  if (!values.reviewerEmail) missing.push("SEO_REVIEW_EMAIL_TO");
  if (!values.reviewTokenSecret) missing.push("SEO_REVIEW_TOKEN_SECRET");
  if (!values.resendApiKey && env.EMAIL_SERVICE_MODE !== "mock" && env.NODE_ENV !== "test") {
    missing.push("RESEND_API_KEY");
  }
  if (!values.schedulerSecret) missing.push("SCHEDULER_SECRET or CRON_SECRET");
  if (!values.firebaseProjectId) missing.push("FIREBASE_PROJECT_ID");
  if (!values.firebaseClientEmail) {
    missing.push("FIREBASE_ADMIN_CLIENT_EMAIL or FIREBASE_CLIENT_EMAIL");
  }
  if (!values.firebasePrivateKey) {
    missing.push("FIREBASE_ADMIN_PRIVATE_KEY or FIREBASE_PRIVATE_KEY");
  }
  return {
    ok: missing.length === 0,
    code: missing.length ? "seo/misconfigured" : null,
    missing,
    values,
  };
}

function requireSeoArticleRuntimeConfig(env = process.env) {
  const config = getSeoArticleRuntimeConfig(env);
  if (!config.ok) {
    const error = new Error(
      `SEO article engine configuration is incomplete: ${config.missing.join(", ")}.`,
    );
    error.code = config.code;
    error.missing = config.missing;
    throw error;
  }
  return config.values;
}

module.exports = {
  getSeoArticleRuntimeConfig,
  requireSeoArticleRuntimeConfig,
};
