import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { checkRateLimit, RateLimitedError } from "@/lib/security/rateLimit.server";
import { getStripeServerClient } from "@/lib/stripe";
import { isSubscriptionTrialEnabled } from "@/lib/subscriptionFlags";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isSubscriptionTrialEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const origin = request.nextUrl.origin;
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const user = await getAdminAuth().verifyIdToken(token);
    if (!user.uid || user.firebase?.sign_in_provider === "anonymous") return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    await checkRateLimit("stripe_portal", user.uid, { max: 5, windowSeconds: 60 });

    const snapshot = await getAdminDb().collection("customers").doc(user.uid).get();
    const customerId = snapshot.exists ? String(snapshot.data()?.stripeCustomerId || "").trim() : "";
    if (!customerId || snapshot.data()?.billingMode !== "subscription") {
      return NextResponse.json({ error: "No subscription is available to manage." }, { status: 404 });
    }
    const session = await getStripeServerClient().billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/account` });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof RateLimitedError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (String(error?.code || "").startsWith("auth/")) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    console.error("[stripe-portal] failed", { code: error?.code || "unknown" });
    return NextResponse.json({ error: "Could not open subscription management right now." }, { status: 500 });
  }
}

