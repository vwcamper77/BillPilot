import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { ANALYTICS_EVENTS } from "@/lib/analytics/constants";
import { createOrUpdateCustomerOnAccountCreated, recordAnalyticsEvent } from "@/lib/customerProfile.server";
import { isInternalAnalyticsRequest } from "@/lib/analytics/internal.server";
import { sendPreviewLifecycleEmail } from "@/lib/previewEmails.server";

export const runtime = "nodejs";

const EVENT_SET = new Set(ANALYTICS_EVENTS);
const DEVICE_TYPES = new Set(["mobile", "tablet", "desktop"]);

/**
 * The one genuinely public write endpoint in the app — most funnel events
 * (landing_page_view, hero_cta_clicked, signup_started) happen before any
 * Firebase user exists, so a Bearer token is optional here, not required.
 * account_created is the one exception: it needs a real uid to write to.
 */
export async function POST(request) {
  try {
    if (isInternalAnalyticsRequest(request)) {
      return NextResponse.json({ ok: true, suppressed: true });
    }
    const body = await request.json().catch(() => ({}));
    const eventName = String(body?.eventName || "").trim();

    if (!EVENT_SET.has(eventName)) {
      return NextResponse.json({ ok: false, error: "Unknown analytics event." }, { status: 400 });
    }

    const decodedToken = await verifyOptionalRequest(request);

    if (eventName === "account_created" && !decodedToken) {
      return NextResponse.json({ ok: false, error: "Sign-in required for this event." }, { status: 401 });
    }

    const uid = decodedToken?.uid || null;

    await recordAnalyticsEvent({
      eventName,
      uid,
      anonymousSessionId: sanitizeString(body?.anonymousSessionId, 128),
      pathname: sanitizeString(body?.pathname, 512),
      referrer: sanitizeString(body?.referrer, 512),
      utm_source: sanitizeString(body?.utm_source, 128),
      utm_medium: sanitizeString(body?.utm_medium, 128),
      utm_campaign: sanitizeString(body?.utm_campaign, 128),
      utm_content: sanitizeString(body?.utm_content, 128),
      utm_term: sanitizeString(body?.utm_term, 128),
      fbclid: sanitizeString(body?.fbclid, 256),
      gclid: sanitizeString(body?.gclid, 256),
      device: sanitizeDevice(body?.device),
      metadata: body?.metadata,
      clientTimestamp: sanitizeString(body?.clientTimestamp, 64),
    });

    if (eventName === "account_created" && uid) {
      // Observe the Firebase account server-side. Email, creation time and UID
      // are never accepted from the analytics request body.
      const authUser = await getAdminAuth().getUser(uid);
      const accountCreatedAt = authUser.metadata?.creationTime || null;
      await createOrUpdateCustomerOnAccountCreated({
        uid,
        email: authUser.email || null,
        name: authUser.displayName || null,
        accountCreatedAt,
        attribution: sanitizeAttributionBundle(body?.attributionBundle) || { firstTouch: sanitizeAttribution(body?.attribution), lastTouch: sanitizeAttribution(body?.attribution) },
      });
      await sendPreviewLifecycleEmail({
        userId: uid,
        email: authUser.email || null,
        type: "account_created",
        period: "account-created",
        onboardingStep: "balance",
      }).catch((error) => console.error("[track] account email failed", { uid, code: error?.code || "email_failed" }));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[track] error", error);
    return NextResponse.json({ ok: false, error: "Could not record that event." }, { status: 500 });
  }
}

async function verifyOptionalRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    return null;
  }

  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return null;
  }
}

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function sanitizeDevice(device) {
  if (!device || typeof device !== "object") {
    return null;
  }

  return {
    type: DEVICE_TYPES.has(device.type) ? device.type : "desktop",
    browser: sanitizeString(device.browser, 32) || "other",
    os: sanitizeString(device.os, 32) || "other",
  };
}

function sanitizeAttribution(attribution) {
  if (!attribution || typeof attribution !== "object") {
    return null;
  }

  return {
    utm_source: sanitizeString(attribution.utm_source, 128),
    utm_medium: sanitizeString(attribution.utm_medium, 128),
    utm_campaign: sanitizeString(attribution.utm_campaign, 128),
    utm_content: sanitizeString(attribution.utm_content, 128),
    utm_term: sanitizeString(attribution.utm_term, 128),
    fbclid: sanitizeString(attribution.fbclid, 256),
    gclid: sanitizeString(attribution.gclid, 256),
    referrer: sanitizeString(attribution.referrer, 512),
    landingPage: sanitizeString(attribution.landingPage, 512),
    anonymousSessionId: sanitizeString(attribution.anonymousSessionId, 128),
    firstSeenAt: sanitizeString(attribution.firstSeenAt, 64),
  };
}

function sanitizeAttributionBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return null;
  const firstTouch = sanitizeAttribution(bundle.firstTouch);
  const lastTouch = sanitizeAttribution(bundle.lastTouch);
  return firstTouch || lastTouch ? { firstTouch: firstTouch || lastTouch, lastTouch: lastTouch || firstTouch } : null;
}
