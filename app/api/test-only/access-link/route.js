import { NextResponse } from "next/server";
import { generateClaimLinkForTesting } from "@/lib/entitlements.server";

export const runtime = "nodejs";

/**
 * Returns a raw generated sign-in link for a pending entitlement, so
 * Playwright can drive the real /access/claim page without real email
 * delivery. Mirrors the existing dev-only TestAuthBridge convention
 * (components/TestAuthBridge.jsx) but with an extra, independent gate: this
 * route 404s unconditionally unless E2E_TEST_SECRET is set AND matches the
 * caller's header — an env var that must never exist in a real production
 * environment. That means even if NODE_ENV/VERCEL_ENV are both wrong in a
 * real deploy, this stays inert unless someone has also deliberately set a
 * matching secret there, which is an explicit, auditable action.
 */
export async function POST(request) {
  const testSecret = process.env.E2E_TEST_SECRET;

  if (!testSecret) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const headerSecret = request.headers.get("x-e2e-test-secret") || "";

  if (headerSecret !== testSecret) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || "").trim();

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
  }

  try {
    const { signInUrl } = await generateClaimLinkForTesting(sessionId);
    return NextResponse.json({ signInUrl });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Could not generate a test link." }, { status: 500 });
  }
}
