const crypto = require("node:crypto");

const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_API_BASE_URL = "https://api.canva.com/rest/v1";
const CANVA_SCOPES = [
  "profile:read",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "design:content:read",
  "design:content:write",
];
const SUPPORTED_CAPABILITIES = ["brand_template", "autofill", "resize"];

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier, "ascii").digest(),
  );

  return { verifier, challenge };
}

function createOAuthState() {
  return base64Url(crypto.randomBytes(32));
}

function hashOAuthState(state) {
  return base64Url(
    crypto.createHash("sha256").update(String(state || ""), "utf8").digest(),
  );
}

function integrationEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function getCanvaConfig(env = process.env) {
  const enabled = integrationEnabled(env.CANVA_INTEGRATION_ENABLED);
  const clientId = String(env.CANVA_CLIENT_ID || "").trim();
  const clientSecret = String(env.CANVA_CLIENT_SECRET || "").trim();
  const redirectUri = String(env.CANVA_REDIRECT_URI || "").trim();

  if (!enabled) {
    return {
      ok: false,
      enabled: false,
      code: "canva/disabled",
      message: "The Canva integration is not enabled.",
    };
  }

  const missing = [];
  if (!clientId) missing.push("CANVA_CLIENT_ID");
  if (!clientSecret) missing.push("CANVA_CLIENT_SECRET");
  if (!redirectUri) missing.push("CANVA_REDIRECT_URI");

  if (missing.length) {
    return {
      ok: false,
      enabled: true,
      code: "canva/misconfigured",
      message: `The Canva integration is missing configuration: ${missing.join(", ")}.`,
    };
  }

  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    return {
      ok: false,
      enabled: true,
      code: "canva/misconfigured",
      message: "CANVA_REDIRECT_URI must be a valid URL.",
    };
  }

  if (!["http:", "https:"].includes(parsedRedirect.protocol)) {
    return {
      ok: false,
      enabled: true,
      code: "canva/misconfigured",
      message: "CANVA_REDIRECT_URI must use HTTP or HTTPS.",
    };
  }

  return {
    ok: true,
    enabled: true,
    clientId,
    clientSecret,
    redirectUri: parsedRedirect.toString(),
  };
}

function buildAuthorizationUrl(config, { state, challenge }) {
  const url = new URL(CANVA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", CANVA_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldRefreshToken(expiresAt, now = Date.now(), skewMs = 60_000) {
  const expiry = timestampToMillis(expiresAt);
  return !expiry || expiry <= now + skewMs;
}

function expiresAtFromSeconds(expiresIn, now = Date.now()) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw Object.assign(new Error("Canva returned an invalid token expiry."), {
      code: "canva/invalid-token-response",
    });
  }
  return new Date(now + seconds * 1000);
}

function normalizeCapabilities(value) {
  const available = new Set(Array.isArray(value) ? value : []);
  return Object.fromEntries(
    SUPPORTED_CAPABILITIES.map((capability) => [
      capability,
      available.has(capability),
    ]),
  );
}

module.exports = {
  CANVA_API_BASE_URL,
  CANVA_SCOPES,
  SUPPORTED_CAPABILITIES,
  buildAuthorizationUrl,
  createOAuthState,
  createPkce,
  expiresAtFromSeconds,
  getCanvaConfig,
  hashOAuthState,
  integrationEnabled,
  normalizeCapabilities,
  shouldRefreshToken,
  timestampToMillis,
};
