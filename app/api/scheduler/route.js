import { NextResponse } from "next/server";
import { runReminderScheduler } from "@/lib/reminders/service.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request) {
  return handleSchedulerRequest(request);
}
export async function POST(request) {
  return handleSchedulerRequest(request);
}

async function handleSchedulerRequest(request) {
  if (!isSchedulerRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const requestedUid = process.env.NODE_ENV !== "production" ? String(url.searchParams.get("uid") || "").trim() : "";
    const nowParam = process.env.NODE_ENV === "test" ? url.searchParams.get("now") : null;
    const now = nowParam ? new Date(nowParam) : new Date();
    return NextResponse.json(await runReminderScheduler({ now, requestedUid }));
  } catch (error) {
    console.error("[reminder-scheduler] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ ok: false, error: "Reminder scheduling failed." }, { status: 500 });
  }
}

function isSchedulerRequest(request) {
  const secret = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
