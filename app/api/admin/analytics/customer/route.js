import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";

export const runtime = "nodejs";

const EVENTS_PER_QUERY_LIMIT = 500;

export async function GET(request) {
  try {
    await verifyAnalyticsAdminRequest(request);

    const { searchParams } = new URL(request.url);
    const uid = String(searchParams.get("uid") || "").trim();

    if (!uid) {
      return NextResponse.json({ ok: false, error: "Missing uid." }, { status: 400 });
    }

    const db = getAdminDb();
    const customerSnapshot = await db.collection("customers").doc(uid).get();

    if (!customerSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
    }

    const customer = customerSnapshot.data();
    const anonymousSessionId = customer?.attribution?.anonymousSessionId || null;

    const queries = [
      db.collection("analyticsEvents").where("uid", "==", uid).limit(EVENTS_PER_QUERY_LIMIT).get(),
    ];

    if (anonymousSessionId) {
      queries.push(
        db.collection("analyticsEvents")
          .where("anonymousSessionId", "==", anonymousSessionId)
          .limit(EVENTS_PER_QUERY_LIMIT)
          .get(),
      );
    }

    const billingSnapshotPromise = db.collection("users").doc(uid).collection("settings").doc("billing").get();

    const [eventSnapshots, billingSnapshot] = await Promise.all([
      Promise.all(queries),
      billingSnapshotPromise,
    ]);

    const eventsById = new Map();
    for (const snapshot of eventSnapshots) {
      for (const doc of snapshot.docs) {
        eventsById.set(doc.id, { id: doc.id, ...doc.data() });
      }
    }

    const timeline = Array.from(eventsById.values())
      .map((event) => ({ ...event, createdAt: serializeTimestamp(event.createdAt) }))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    return NextResponse.json({
      ok: true,
      customer: {
        uid,
        name: customer.name || null,
        email: customer.email || null,
        createdAt: serializeTimestamp(customer.createdAt),
        lastActiveAt: serializeTimestamp(customer.lastActiveAt),
        attribution: customer.attribution || null,
        stripeCustomerId: customer.stripeCustomerId || null,
        paymentStatus: customer.paymentStatus || "none",
        subscriptionStatus: customer.subscriptionStatus || "none",
        totalPaid: Number(customer.totalPaid) || 0,
        currency: customer.currency || "gbp",
        billsCount: Number(customer.billsCount) || 0,
        onboardingStatus: customer.onboardingStatus || "not_started",
        dropOffStage: customer.dropOffStage || null,
      },
      billing: billingSnapshot.exists ? billingSnapshot.data() : null,
      timeline,
    });
  } catch (error) {
    if (
      error?.code === "auth/missing-id-token"
      || error?.code === "auth/invalid-id-token"
      || error?.code === "auth/id-token-expired"
    ) {
      return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    }

    if (error?.code === "auth/forbidden") {
      return NextResponse.json({ ok: false, error: "You are not allowed to view analytics." }, { status: 403 });
    }

    console.error("[admin-analytics-customer] error", error);

    return NextResponse.json({ ok: false, error: "Could not load that customer right now." }, { status: 500 });
  }
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return new Date(value).toISOString();
}
