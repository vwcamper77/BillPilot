const FIREBASE_SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;
const PRODUCTION_SESSION_COOKIE = "__Host-cleartill_session";
const DEVELOPMENT_SESSION_COOKIE = "cleartill_session";

function firebaseSessionCookieName(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production"
    ? PRODUCTION_SESSION_COOKIE
    : DEVELOPMENT_SESSION_COOKIE;
}

function parseCookieHeader(header, name) {
  const expected = `${String(name || "")}=`;
  for (const item of String(header || "").split(";")) {
    const part = item.trim();
    if (!part.startsWith(expected)) continue;
    try {
      return decodeURIComponent(part.slice(expected.length));
    } catch {
      return "";
    }
  }
  return "";
}

function isSameOriginRequest(requestUrl, originHeader) {
  if (!originHeader) return false;
  try {
    return new URL(requestUrl).origin === new URL(originHeader).origin;
  } catch {
    return false;
  }
}

function sessionCookieOptions(nodeEnv = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(FIREBASE_SESSION_DURATION_MS / 1000),
    priority: "high",
  };
}

module.exports = {
  DEVELOPMENT_SESSION_COOKIE,
  FIREBASE_SESSION_DURATION_MS,
  PRODUCTION_SESSION_COOKIE,
  firebaseSessionCookieName,
  isSameOriginRequest,
  parseCookieHeader,
  sessionCookieOptions,
};
