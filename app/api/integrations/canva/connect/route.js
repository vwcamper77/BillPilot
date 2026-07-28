import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import {
  canvaErrorResponse,
  createCanvaAuthorization,
} from "@/lib/integrations/canva.server";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await verifyRequestUser(request);
    if (user?.firebase?.sign_in_provider === "anonymous") {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          code: "auth/account-required",
          error: "Create or sign in to a ClearTill account before connecting Canva.",
        },
        { status: 401 },
      );
    }

    const authorizationUrl = await createCanvaAuthorization(user.uid);
    return NextResponse.redirect(authorizationUrl, { status: 302 });
  } catch (error) {
    console.error("[canva/connect] failed", {
      code: error?.code || "unknown",
      message: error?.message || "Unknown error",
    });
    const response = canvaErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
