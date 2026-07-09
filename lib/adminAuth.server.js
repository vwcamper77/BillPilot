import { getAdminAuth } from "@/lib/firebaseAdmin";

/**
 * Shared Bearer-token verification, following the pattern already
 * duplicated per-route across the app (dashboard/bills, security,
 * founding-access, etc).
 */
export async function verifyIdTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Unauthorized");
    error.code = "auth/invalid-id-token";
    throw error;
  }
}

export function isEmailInAllowlist(email, envVarName) {
  const allowedEmails = new Set(
    String(process.env[envVarName] || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return Boolean(normalizedEmail) && allowedEmails.has(normalizedEmail);
}

export function isAnalyticsAdminEmail(email) {
  return isEmailInAllowlist(email, "ADMIN_EMAILS");
}

/**
 * Verifies the request's ID token AND that the caller's email is in
 * ADMIN_EMAILS. Throws auth/forbidden if signed in but not an admin.
 */
export async function verifyAnalyticsAdminRequest(request) {
  const decodedToken = await verifyIdTokenFromRequest(request);

  if (!isAnalyticsAdminEmail(decodedToken.email)) {
    const error = new Error("Forbidden");
    error.code = "auth/forbidden";
    throw error;
  }

  return decodedToken;
}
