import { NextResponse } from "next/server";
import { verifyRequestUser } from "@/lib/serverAuth";
import {
  canvaErrorResponse,
  disconnectCanva,
} from "@/lib/integrations/canva.server";

export const runtime = "nodejs";

export async function DELETE(request) {
  try {
    const user = await verifyRequestUser(request);
    const disconnected = await disconnectCanva(user.uid);
    return NextResponse.json({
      ok: true,
      connected: false,
      message: disconnected
        ? "Canva disconnected successfully."
        : "Canva was already disconnected.",
    });
  } catch (error) {
    console.error("[canva/disconnect] failed", {
      code: error?.code || "unknown",
      message: error?.message || "Unknown error",
    });
    const response = canvaErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
