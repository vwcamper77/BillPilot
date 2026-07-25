import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getSecret(env = process.env) {
  const secret = String(env.SEO_REVIEW_TOKEN_SECRET || "").trim();
  if (secret.length < 32) {
    throw new Error("SEO_REVIEW_TOKEN_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function createSeoReviewToken({ draftId, action, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS }, env = process.env) {
  if (!draftId || !["approve", "changes", "reject"].includes(action)) {
    throw new Error("A valid draftId and review action are required.");
  }

  const payload = base64url(JSON.stringify({
    v: TOKEN_VERSION,
    draftId,
    action,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
  }));

  return `${payload}.${sign(payload, getSecret(env))}`;
}

export function verifySeoReviewToken(token, { expectedAction, now = Date.now() } = {}, env = process.env) {
  const [payload, suppliedSignature, extra] = String(token || "").split(".");
  if (!payload || !suppliedSignature || extra) return { valid: false, reason: "Malformed token" };

  const expectedSignature = sign(payload, getSecret(env));
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return { valid: false, reason: "Invalid signature" };
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "Invalid payload" };
  }

  if (claims.v !== TOKEN_VERSION) return { valid: false, reason: "Unsupported token version" };
  if (!claims.draftId || !["approve", "changes", "reject"].includes(claims.action)) {
    return { valid: false, reason: "Invalid claims" };
  }
  if (expectedAction && claims.action !== expectedAction) return { valid: false, reason: "Action mismatch" };
  if (!Number.isFinite(claims.exp) || claims.exp < Math.floor(now / 1000)) {
    return { valid: false, reason: "Expired token" };
  }

  return { valid: true, claims };
}
