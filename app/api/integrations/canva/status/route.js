import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import {
  canvaErrorResponse,
  getCanvaStatus,
} from "@/lib/integrations/canva.server";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = await verifyRequestUser(request);
    const status = await getCanvaStatus(user.uid);
    return NextResponse.json({
      ok: true,
      message: status.connected
        ? "Canva is connected."
        : status.enabled
          ? "Canva is not connected."
          : "The Canva integration is not enabled.",
      ...status,
    });
  } catch (error) {
    console.error("[canva/status] failed", {
      code: error?.code || "unknown",
      message: error?.message || "Unknown error",
    });
    const response = canvaErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
