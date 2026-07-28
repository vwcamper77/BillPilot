import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import sessionCore from "@/lib/auth/sessionCore.cjs";

const {
  FIREBASE_SESSION_DURATION_MS,
  firebaseSessionCookieName,
  isSameOriginRequest,
  sessionCookieOptions,
} = sessionCore;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body, status) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function trustedBrowserRequest(request) {
  return isSameOriginRequest(request.url, request.headers.get("origin"));
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

export async function POST(request) {
  if (!trustedBrowserRequest(request)) {
    return noStoreJson(
      { ok: false, error: "The browser session request was not accepted." },
      403,
    );
  }

  const idToken = bearerToken(request);
  if (!idToken) {
    return noStoreJson(
      { ok: false, error: "A Firebase ID token is required." },
      401,
    );
  }

  try {
    const adminAuth = getAdminAuth();
    await adminAuth.verifyIdToken(idToken, true);
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: FIREBASE_SESSION_DURATION_MS,
    });
    const response = noStoreJson({ ok: true }, 200);
    response.cookies.set(
      firebaseSessionCookieName(),
      sessionCookie,
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    console.error("[auth/session] create failed", {
      code: error?.code || "auth/session-cookie-failed",
    });
    return noStoreJson(
      { ok: false, error: "Please sign in to ClearTill again." },
      401,
    );
  }
}

export async function DELETE(request) {
  if (!trustedBrowserRequest(request)) {
    return noStoreJson(
      { ok: false, error: "The browser session request was not accepted." },
      403,
    );
  }

  const response = noStoreJson({ ok: true }, 200);
  response.cookies.set(firebaseSessionCookieName(), "", {
    ...sessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
