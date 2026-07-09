import { NextResponse } from "next/server";
import { grantFoundingAccessFromCheckoutSessionId } from "@/lib/billingAccess.server";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || "").trim();

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "Missing checkout session id." },
      { status: 400 },
    );
  }

  try {
    const accessRecord = await grantFoundingAccessFromCheckoutSessionId(sessionId);

    return NextResponse.json({
      ok: true,
      accessUntil: accessRecord?.accessUntil || accessRecord?.accessExpiresAt || null,
    });
  } catch (error) {
    console.error("[billing-access] repair route failed", {
      stripeSessionId: sessionId,
      uid: error?.context?.uid || null,
      email: error?.context?.email || null,
      paymentStatus: error?.context?.paymentStatus || null,
      attemptedUserDocPath: error?.context?.attemptedUserDocPath || "",
      attemptedBillingDocPath: error?.context?.attemptedBillingDocPath || "",
      firebaseProjectId: error?.context?.firebaseProjectId || "",
    }, error);

    return NextResponse.json(
      { ok: false, error: error?.message || "Could not repair access right now." },
      { status: 500 },
    );
  }
}
