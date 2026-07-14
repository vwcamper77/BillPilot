import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const INTERNAL_ANALYTICS_COOKIE = "ct_internal_analytics";
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const value = String(process.env.INTERNAL_ANALYTICS_COOKIE_SECRET || "").trim();
  if (value.length < 32) return null;
  return value;
}

export function getInternalAnalyticsUids() {
  return new Set(String(process.env.INTERNAL_ANALYTICS_UIDS || "")
    .split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9:_-]{1,128}$/.test(value)));
}

export function isInternalAnalyticsUid(uid) {
  return Boolean(uid) && getInternalAnalyticsUids().has(String(uid));
}

function signature(encoded) {
  const key = secret();
  return key ? createHmac("sha256", key).update(encoded).digest("base64url") : "";
}

export function createInternalAnalyticsCookie(now = Date.now()) {
  if (!secret()) throw new Error("INTERNAL_ANALYTICS_COOKIE_SECRET must contain at least 32 characters.");
  const payload = {
    v: String(process.env.INTERNAL_ANALYTICS_COOKIE_VERSION || "1").slice(0, 32),
    exp: Math.floor(now / 1000) + COOKIE_TTL_SECONDS,
    browser: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyInternalAnalyticsCookie(value, now = Date.now()) {
  const [encoded, supplied] = String(value || "").split(".");
  const expected = encoded ? signature(encoded) : "";
  if (!encoded || !supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.v === String(process.env.INTERNAL_ANALYTICS_COOKIE_VERSION || "1")
      && Number(payload.exp) > Math.floor(now / 1000)
      && typeof payload.browser === "string";
  } catch {
    return false;
  }
}

function cookieValueFromRequest(request) {
  return request?.cookies?.get?.(INTERNAL_ANALYTICS_COOKIE)?.value
    || String(request?.headers?.get?.("cookie") || "").split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${INTERNAL_ANALYTICS_COOKIE}=`))?.slice(INTERNAL_ANALYTICS_COOKIE.length + 1)
    || "";
}

export function isInternalAnalyticsRequest(request) {
  return verifyInternalAnalyticsCookie(cookieValueFromRequest(request));
}

export function shouldSendProductionAnalytics({ internalTest = false } = {}) {
  return !internalTest;
}

export const internalCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: COOKIE_TTL_SECONDS,
};
