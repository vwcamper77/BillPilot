import { NextResponse } from "next/server";
import { processResendWebhook, verifyResendWebhookRequest } from "@/lib/reminders/providerWebhook.server";

export const runtime = "nodejs";

export async function POST(request) {
  const payload = await request.text();
  if (!verifyResendWebhookRequest({ payload, headers: request.headers })) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
  }
  try {
    const event = JSON.parse(payload);
    return NextResponse.json(await processResendWebhook({ webhookId: request.headers.get("svix-id"), event }));
  } catch (error) {
    console.error("[email-webhook] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}
