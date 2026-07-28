import { getAdminAuth } from "@/lib/firebaseAdmin";
import sessionCore from "@/lib/auth/sessionCore.cjs";

const {
  firebaseSessionCookieName,
  parseCookieHeader,
} = sessionCore;

function requestSessionCookie(request) {
  const name = firebaseSessionCookieName();
  const nextCookie = request.cookies?.get?.(name);
  if (typeof nextCookie === "string") return nextCookie;
  if (nextCookie?.value) return nextCookie.value;
  return parseCookieHeader(request.headers.get("cookie"), name);
}

function authError(code = "auth/missing-id-token") {
  const error = new Error("Unauthorized");
  error.code = code;
  return error;
}

export async function getCurrentUser(
  request,
  { allowSessionCookie = true } = {},
) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (match?.[1]) {
    return getAdminAuth().verifyIdToken(match[1]);
  }

  if (!allowSessionCookie) throw authError();

  const sessionCookie = requestSessionCookie(request);
  if (!sessionCookie) throw authError();

  try {
    return await getAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch {
    throw authError("auth/invalid-session-cookie");
  }
}

export async function verifyRequestUser(request) {
  // Existing JSON APIs remain bearer-only. Cookie authentication is opt-in for
  // browser-navigation endpoints that are safe with SameSite=Lax semantics.
  return getCurrentUser(request, { allowSessionCookie: false });
}
