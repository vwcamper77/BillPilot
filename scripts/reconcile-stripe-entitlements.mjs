/**
 * Read-only Stripe/Firebase/Resend reconciliation. It never creates charges or writes data.
 * Defaults to the previous Europe/London calendar day; use --date=YYYY-MM-DD.
 * Required env: STRIPE_SECRET_KEY and Firebase Admin credentials. RESEND_API_KEY is optional.
 */
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

loadLocalEnv();
const forbiddenMode = process.argv.slice(2).find((argument) => /^--(?:apply|write|backfill|repair|mutate|commit)(?:=|$)/i.test(argument));
if (forbiddenMode) throw new Error(`Mutation mode ${forbiddenMode} is forbidden: this reconciliation command is strictly read-only.`);
if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY.");
if (!getApps().length) initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: String(process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
}) });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const db = getFirestore();
const auth = getAuth();
const range = londonRange();
const sessions = await listAll((params) => stripe.checkout.sessions.list(params), {
  created: { gte: range.start, lt: range.end }, limit: 100,
});
const paymentIntents = await listAll((params) => stripe.paymentIntents.list(params), {
  created: { gte: range.start, lt: range.end }, limit: 100,
});
const fivePoundIntents = paymentIntents.filter((intent) => Number(intent.amount_received || intent.amount) === 500 && String(intent.currency).toLowerCase() === "gbp");
const sessionsById = new Map(sessions
  .filter((session) => Number(session.amount_total) === 500 && String(session.currency).toLowerCase() === "gbp")
  .map((session) => [session.id, session]));
for (const intent of fivePoundIntents) {
  const linked = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 100 });
  for (const session of linked.data) sessionsById.set(session.id, session);
}
const candidates = [...sessionsById.values()];
const stripeEvents = await listAll((params) => stripe.events.list(params), {
  created: { gte: range.start, lt: range.end }, limit: 100,
});
const report = { mode: "read-only", range: range.label, matches: [], findings: [] };

for (const item of candidates) {
  const session = await stripe.checkout.sessions.retrieve(item.id, { expand: ["payment_intent", "subscription", "customer"] });
  const email = String(session.customer_details?.email || session.customer_email || session.customer?.email || "").toLowerCase();
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const metadataUid = String(session.metadata?.firebaseUid || session.metadata?.userId || session.client_reference_id || "").trim();
  let authUser = null;
  if (metadataUid) authUser = await auth.getUser(metadataUid).catch(() => null);
  if (!authUser && email) authUser = await auth.getUserByEmail(email).catch(() => null);
  const uid = authUser?.uid || metadataUid || null;
  const relevantStripeEvents = stripeEvents.filter((event) => stripeEventReferences(event, [
    session.id,
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
  ]));
  const eventIds = relevantStripeEvents.map((event) => event.id);
  const [entitlement, customer, legacyBilling, sessionEventDocs, ...eventSnapshots] = await Promise.all([
    db.collection("pendingEntitlements").doc(session.id).get(),
    uid ? db.collection("customers").doc(uid).get() : Promise.resolve(null),
    uid ? db.collection("users").doc(uid).collection("settings").doc("billing").get() : Promise.resolve(null),
    db.collection("stripeEvents").where("stripeCheckoutSessionId", "==", session.id).limit(20).get(),
    ...eventIds.map((eventId) => db.collection("stripeEvents").doc(eventId).get()),
  ]);
  const ent = entitlement?.exists ? entitlement.data() : null;
  const eventsById = new Map(sessionEventDocs.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  for (const snapshot of eventSnapshots) {
    if (snapshot.exists) eventsById.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
  }
  const events = [...eventsById.values()];
  const providerId = ent?.emailOutbox?.providerId || null;
  const providerDelivery = await resendDelivery(providerId);
  const subscriptions = stripeCustomerId
    ? await listAll((params) => stripe.subscriptions.list(params), { customer: stripeCustomerId, status: "all", limit: 100 })
    : [];
  const liveSubscriptions = subscriptions.filter((subscription) => ["trialing", "active", "past_due", "incomplete", "unpaid", "paused"].includes(subscription.status));
  const warnings = [];
  if (session.payment_status === "paid" && !ent) warnings.push("stripe_paid_but_no_entitlement");
  if (!uid) warnings.push("firebase_uid_missing");
  if (email && authUser?.email && email !== authUser.email.toLowerCase()) warnings.push("email_mismatch");
  if (ent && !customer?.exists) warnings.push("entitlement_but_no_admin_customer");
  if (!events.length) warnings.push("webhook_event_record_missing");
  if (events.some((event) => event.processingStatus === "failed")) warnings.push("webhook_processing_failure");
  if (!metadataUid) warnings.push("uid_missing_from_stripe_metadata");
  if (liveSubscriptions.length > 1) warnings.push("duplicate_subscriptions");
  report.matches.push({
    stripeCustomerId,
    checkoutSessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    subscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null,
    relatedSubscriptions: subscriptions.map((subscription) => ({ id: subscription.id, status: subscription.status, firebaseUid: subscription.metadata?.firebaseUid || null })),
    purchaserEmail: email || null,
    firebaseUid: uid,
    paymentStatus: session.payment_status,
    stripeEvents: relevantStripeEvents.map((event) => ({ id: event.id, type: event.type, created: new Date(event.created * 1000).toISOString() })),
    webhookEvents: events.map((event) => ({ id: event.id, type: event.type, status: event.processingStatus || "legacy_unknown" })),
    entitlement: ent ? { status: ent.status, accessType: ent.planKey, emailStatus: ent.emailOutbox?.status || "unverifiable" } : null,
    adminCustomer: Boolean(customer?.exists),
    legacyBilling: Boolean(legacyBilling?.exists),
    email: { providerMessageId: providerId, deliveryStatus: providerDelivery },
    warnings,
  });
  report.findings.push(...warnings.map((type) => ({ type, checkoutSessionId: session.id, firebaseUid: uid })));
}

function stripeEventReferences(event, identifiers) {
  const wanted = new Set(identifiers.filter(Boolean).map(String));
  if (!wanted.size) return false;
  const object = event?.data?.object || {};
  const candidates = [
    object.id,
    typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id,
    typeof object.subscription === "string" ? object.subscription : object.subscription?.id,
    object.checkout_session,
    object.client_reference_id,
  ].filter(Boolean).map(String);
  return candidates.some((value) => wanted.has(value));
}

const entitlementSnapshot = await db.collection("pendingEntitlements").limit(2000).get();
const checkedSessions = new Set(report.matches.map((match) => match.checkoutSessionId));
for (const doc of entitlementSnapshot.docs) {
  const entitlement = doc.data();
  if (entitlement.paymentType !== "paid" || entitlement.internalTest || checkedSessions.has(doc.id)) continue;
  const sessionId = String(entitlement.stripeCheckoutSessionId || doc.id || "");
  if (!sessionId.startsWith("cs_")) {
    report.findings.push({ type: "entitlement_but_no_stripe_record", checkoutSessionId: sessionId || null, firebaseUid: entitlement.uid || null });
    continue;
  }
  const exists = await stripe.checkout.sessions.retrieve(sessionId).then(() => true).catch(() => false);
  if (!exists) report.findings.push({ type: "entitlement_but_no_stripe_record", checkoutSessionId: sessionId, firebaseUid: entitlement.uid || null });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function listAll(fetchPage, initial) {
  const rows = [];
  let params = initial;
  for (;;) {
    const page = await fetchPage(params);
    rows.push(...page.data);
    if (!page.has_more || !page.data.length) return rows;
    params = { ...initial, starting_after: page.data.at(-1).id };
  }
}

async function resendDelivery(providerId) {
  if (!providerId) return "never_triggered_or_unverifiable";
  if (!process.env.RESEND_API_KEY) return "provider_lookup_unavailable";
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (!response.ok) return `lookup_failed_${response.status}`;
  const payload = await response.json();
  return payload.last_event || "sent_provider_status_unknown";
}

function londonRange() {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];
  const label = dateArg || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 86400000));
  const [year, month, day] = label.split("-").map(Number);
  const nextLabel = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    label,
    start: londonMidnightEpoch(label),
    end: londonMidnightEpoch(nextLabel),
  };
}

function londonMidnightEpoch(label) {
  const [year, month, day] = label.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  let candidate = utcMidnight;

  // Resolve the offset twice so dates around GMT/BST transitions use the
  // actual Europe/London midnight and the correct 23/25-hour day boundary.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    candidate = utcMidnight - londonOffsetMilliseconds(new Date(candidate));
  }
  return Math.floor(candidate / 1000);
}

function londonOffsetMilliseconds(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return representedAsUtc - date.getTime();
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !(match[1].trim() in process.env)) process.env[match[1].trim()] = match[2].trim();
  }
}
