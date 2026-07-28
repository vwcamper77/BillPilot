import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/serverAuth";
import {
  canvaErrorResponse,
  createCanvaAuthorization,
} from "@/lib/integrations/canva.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreRedirect(url) {
  const response = NextResponse.redirect(url, { status: 302 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function signInRedirect(request) {
  const url = new URL("/signin", request.url);
  url.searchParams.set("next", "/api/integrations/canva/connect");
  return noStoreRedirect(url);
}

export async function GET(request) {
  try {
    const user = await getCurrentUser(request);
    if (user?.firebase?.sign_in_provider === "anonymous") {
      return signInRedirect(request);
    }

    const authorizationUrl = await createCanvaAuthorization(user.uid);
    return noStoreRedirect(authorizationUrl);
  } catch (error) {
    if (error?.code?.startsWith?.("auth/")) {
      return signInRedirect(request);
    }
    console.error("[canva/connect] failed", {
      code: error?.code || "unknown",
      message: error?.message || "Unknown error",
    });
    const response = canvaErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
