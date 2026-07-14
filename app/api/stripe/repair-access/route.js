import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request) {
  await request.json().catch(() => ({}));
  return NextResponse.json({ ok: false, error: "Access can only be fulfilled by a verified Stripe webhook. Please retry shortly or contact support." }, { status: 409 });
}
