import { getAdminAuth } from "@/lib/firebaseAdmin";

export async function verifyRequestUser(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }

  return getAdminAuth().verifyIdToken(match[1]);
}
