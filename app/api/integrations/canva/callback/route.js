import { NextResponse } from "next/server";
import {
  canvaErrorResponse,
  completeCanvaAuthorization,
  consumeCanvaOAuthState,
} from "@/lib/integrations/canva.server";

export const runtime = "nodejs";

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  try {
    if (oauthError) {
      await consumeCanvaOAuthState(state);
      const description = searchParams.get("error_description");
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          code: `canva/${oauthError}`,
          error: description || "Canva connection was cancelled.",
        },
        { status: 400 },
      );
    }

    const result = await completeCanvaAuthorization({
      code: searchParams.get("code"),
      state,
    });
    return NextResponse.json({
      ok: true,
      message: "Canva connected successfully.",
      ...result,
    });
  } catch (error) {
    console.error("[canva/callback] failed", {
      code: error?.code || "unknown",
      message: error?.message || "Unknown error",
    });
    const response = canvaErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
