import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyAnalyticsAdminRequest } from "@/lib/adminAuth.server";
import { FUNNEL_STAGES } from "@/lib/analytics/constants";

export const runtime = "nodejs";

const HAS_SUBSCRIPTIONS = true;
const MONTHLY_SUBSCRIPTION_GBP = 1.99;

const CUSTOMERS_LIMIT = 2000;
const PAID_CUSTOMERS_LIMIT = 5000;
const EVENTS_LIMIT = 20000;

export async function GET(request) {
  try {
    await verifyAnalyticsAdminRequest(request);

    const { searchParams } = new URL(request.url);
    const rangeParam = searchParams.get("rangeDays") || "30";
    const rangeDays = rangeParam === "all" ? null : Math.max(1, Number(rangeParam) || 30);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const rangeStart = rangeDays ? new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000) : null;

    const db = getAdminDb();
    const customersCollection = db.collection("customers");
    const eventsCollection = db.collection("analyticsEvents");
    const adSpendCollection = db.collection("adSpend");

    const [
      totalSignupsSnapshot,
      signupsTodaySnapshot,
      signupsWeekSnapshot,
      signupsMonthSnapshot,
      paidCustomersCountSnapshot,
      trialUsersSnapshot,
      activeSubscriptionsSnapshot,
      paidCustomersSnapshot,
      rangedCustomersSnapshot,
      rangedEventsSnapshot,
      adSpendSnapshot,
      internalCustomersSnapshot,
      pendingEntitlementsSnapshot,
    ] = await Promise.all([
      customersCollection.count().get(),
      customersCollection.where("createdAt", ">=", startOfToday).count().get(),
      customersCollection.where("createdAt", ">=", startOfWeek).count().get(),
      customersCollection.where("createdAt", ">=", startOfMonth).count().get(),
      customersCollection.where("paymentStatus", "==", "paid").count().get(),
      customersCollection.where("subscriptionStatus", "==", "trialing").count().get(),
      customersCollection.where("subscriptionStatus", "==", "active").count().get(),
      customersCollection.where("paymentStatus", "==", "paid").limit(PAID_CUSTOMERS_LIMIT).get(),
      (rangeStart
        ? customersCollection.where("createdAt", ">=", rangeStart).orderBy("createdAt", "desc")
        : customersCollection.orderBy("createdAt", "desc")
      ).limit(CUSTOMERS_LIMIT).get(),
      (rangeStart
        ? eventsCollection.where("createdAt", ">=", rangeStart)
        : eventsCollection
      ).limit(EVENTS_LIMIT).get(),
      (rangeStart
        ? adSpendCollection.where("date", ">=", isoDate(rangeStart))
        : adSpendCollection
      ).limit(EVENTS_LIMIT).get(),
      customersCollection.where("internalTest", "==", true).limit(CUSTOMERS_LIMIT).get(),
      db.collection("pendingEntitlements").limit(CUSTOMERS_LIMIT).get(),
    ]);

    const internalCustomers = internalCustomersSnapshot.docs.map((doc) => doc.data());
    const internalCreatedSince = (date) => internalCustomers.filter((customer) => toDate(customer.createdAt) >= date).length;
    const internalWithStatus = (status) => internalCustomers.filter((customer) => customer.subscriptionStatus === status).length;
    const totalSignups = Math.max(0, (totalSignupsSnapshot.data().count || 0) - internalCustomers.length);
    const paidCustomers = paidCustomersCountSnapshot.data().count || 0;
    const paidCustomerDocs = paidCustomersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const totalRevenue = paidCustomerDocs.reduce((sum, customer) => sum + (Number(customer.totalPaid) || 0), 0);
    const paidCustomersInRange = rangeStart
      ? paidCustomerDocs.filter((customer) => toDate(customer.createdAt) >= rangeStart)
      : paidCustomerDocs;
    // customers.totalPaid is stored in pence (matches Stripe/billing convention
    // elsewhere in the app); adSpend.spend is entered in whole pounds. Convert
    // revenue to pounds here so every money figure below is in the same unit.
    const totalRevenueGbp = totalRevenue / 100;
    const revenueInRangeGbp = paidCustomersInRange.reduce((sum, customer) => sum + (Number(customer.totalPaid) || 0), 0) / 100;

    const adSpendEntries = adSpendSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const totalAdSpend = adSpendEntries.reduce((sum, entry) => sum + (Number(entry.spend) || 0), 0);
    const hasAdSpend = adSpendEntries.length > 0;

    const kpis = {
      totalSignups,
      signupsToday: Math.max(0, (signupsTodaySnapshot.data().count || 0) - internalCreatedSince(startOfToday)),
      signupsWeek: Math.max(0, (signupsWeekSnapshot.data().count || 0) - internalCreatedSince(startOfWeek)),
      signupsMonth: Math.max(0, (signupsMonthSnapshot.data().count || 0) - internalCreatedSince(startOfMonth)),
      paidCustomers,
      trialUsers: HAS_SUBSCRIPTIONS ? Math.max(0, (trialUsersSnapshot.data().count || 0) - internalWithStatus("trialing")) : null,
      hasSubscriptions: HAS_SUBSCRIPTIONS,
      conversionRate: totalSignups > 0 ? paidCustomers / totalSignups : 0,
      totalRevenue: totalRevenueGbp,
      mrr: HAS_SUBSCRIPTIONS ? Math.max(0, (activeSubscriptionsSnapshot.data().count || 0) - internalWithStatus("active")) * MONTHLY_SUBSCRIPTION_GBP : null,
      arpu: paidCustomers > 0 ? totalRevenueGbp / paidCustomers : 0,
      cac: hasAdSpend && paidCustomersInRange.length > 0 ? totalAdSpend / paidCustomersInRange.length : null,
      roas: hasAdSpend && totalAdSpend > 0 ? revenueInRangeGbp / totalAdSpend : null,
      hasAdSpend,
      currency: "gbp",
    };

    const events = rangedEventsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const funnel = buildFunnel(events);

    const externalCustomerDocs = rangedCustomersSnapshot.docs.filter((doc) => !doc.data()?.internalTest && !doc.data()?.excludedFromCommercialReporting);
    const customers = externalCustomerDocs.map((doc) => serializeCustomer(doc.id, doc.data()));
    const customerIndexBySession = new Map(customers.map((customer, index) => [customer.stripeCheckoutSessionId, index]).filter(([sessionId]) => sessionId));
    const customerIndexByUid = new Map(customers.map((customer, index) => [customer.uid, index]).filter(([uid]) => uid));
    for (const doc of pendingEntitlementsSnapshot.docs) {
      const entitlement = doc.data();
      if (entitlement.internalTest) continue;
      const pending = serializePendingEntitlement(doc.id, entitlement);
      const existingIndex = customerIndexBySession.get(doc.id) ?? customerIndexByUid.get(entitlement.uid);
      if (existingIndex === undefined) {
        customers.push(pending);
        customerIndexBySession.set(doc.id, customers.length - 1);
        if (entitlement.uid) customerIndexByUid.set(entitlement.uid, customers.length - 1);
      } else {
        const existing = customers[existingIndex];
        customers[existingIndex] = {
          ...pending,
          ...existing,
          uid: existing.uid,
          email: existing.email || existing.authenticatedEmail || null,
          authenticatedEmail: existing.authenticatedEmail || existing.email || null,
          paymentEmail: pending.paymentEmail || existing.paymentEmail,
          stripeCustomerId: pending.stripeCustomerId || existing.stripeCustomerId,
          stripeCheckoutSessionId: pending.stripeCheckoutSessionId || existing.stripeCheckoutSessionId,
          stripePaymentIntentId: pending.stripePaymentIntentId || existing.stripePaymentIntentId,
          emailNotificationStatus: pending.emailNotificationStatus || existing.emailNotificationStatus,
          emailProviderMessageId: pending.emailProviderMessageId || existing.emailProviderMessageId,
          emailType: pending.emailType || existing.emailType,
          reconciliationWarning: entitlement.status === "active" || entitlement.status === "claimed"
            ? null
            : pending.reconciliationWarning,
        };
      }
    }
    const adPerformance = buildAdPerformance(events, externalCustomerDocs.map((d) => ({ id: d.id, ...d.data() })), paidCustomersInRange, adSpendEntries);

    const response = NextResponse.json({
      ok: true,
      range: { rangeDays: rangeDays ?? "all" },
      kpis,
      funnel,
      adPerformance,
      customers,
      adSpendEntries: adSpendEntries.map(serializeAdSpend),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
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

    console.error("[admin-analytics] error", error);

    return NextResponse.json({ ok: false, error: "Could not load analytics right now." }, { status: 500 });
  }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toDate(value) {
  if (!value) return new Date(0);
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return new Date(value).toISOString();
}

function serializeCustomer(id, data) {
  const firstTouch = data.firstTouchAttribution || data.attribution?.firstTouch || data.attribution || null;
  const lastTouch = data.lastTouchAttribution || data.attribution?.lastTouch || firstTouch;
  return {
    uid: id,
    name: data.name || null,
    email: data.email || null,
    authenticatedEmail: data.authenticatedEmail || data.email || null,
    paymentEmail: data.paymentEmail || null,
    createdAt: serializeTimestamp(data.createdAt),
    lastActiveAt: serializeTimestamp(data.lastActiveAt),
    paymentStatus: data.paymentStatus || "none",
    totalPaid: Number(data.totalPaid) || 0,
    currency: data.currency || "gbp",
    stripeCustomerId: data.stripeCustomerId || null,
    stripeCheckoutSessionId: data.stripeCheckoutSessionId || null,
    stripePaymentIntentId: data.stripePaymentIntentId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    accessType: data.accessType || "none",
    entitlementStatus: data.entitlementStatus || "none",
    subscriptionStatus: data.subscriptionStatus || "none",
    trialStartedAt: serializeTimestamp(data.trialStartedAt),
    trialEndsAt: serializeTimestamp(data.trialEndsAt),
    currentPeriodEnd: serializeTimestamp(data.currentPeriodEnd),
    lastWebhookEventId: data.lastWebhookEventId || null,
    emailNotificationStatus: data.emailNotificationStatus || "unverifiable",
    emailProviderMessageId: data.emailProviderMessageId || null,
    emailType: data.emailType || null,
    reconciliationWarning: data.reconciliationWarning || null,
    attribution: firstTouch,
    firstTouchAttribution: firstTouch,
    lastTouchAttribution: lastTouch,
    billsCount: Number(data.billsCount) || 0,
    onboardingStatus: data.onboardingStatus || "not_started",
    dropOffStage: data.dropOffStage || null,
    firstActionAfterSignup: data.firstActionAfterSignup || null,
    lastDevice: data.lastDevice || null,
  };
}

function serializePendingEntitlement(sessionId, data) {
  return {
    uid: data.uid || `pending:${sessionId}`,
    name: null,
    email: data.checkoutEmail || null,
    authenticatedEmail: null,
    paymentEmail: data.checkoutEmail || null,
    createdAt: serializeTimestamp(data.createdAt),
    lastActiveAt: null,
    paymentStatus: data.paymentType === "paid" ? "paid" : data.paymentType || "none",
    totalPaid: Number(data.amountPaidMinor ?? data.amountPaid) || 0,
    currency: data.currency || "gbp",
    stripeCustomerId: data.stripeCustomerId || null,
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: data.stripePaymentIntentId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    accessType: "founding_member",
    entitlementStatus: data.status || "pending_claim",
    subscriptionStatus: "none",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    lastWebhookEventId: data.webhookEventId || null,
    emailNotificationStatus: data.emailOutbox?.status || "never_triggered",
    emailProviderMessageId: data.emailOutbox?.providerId || null,
    emailType: "founding_member_access",
    reconciliationWarning: data.uid ? "entitlement_not_synchronised_to_customer" : "paid_access_not_claimed_no_firebase_uid",
    attribution: data.attribution || null,
    billsCount: 0,
    onboardingStatus: "not_started",
    dropOffStage: null,
    firstActionAfterSignup: null,
    lastDevice: null,
  };
}

function serializeAdSpend(entry) {
  return {
    id: entry.id,
    date: entry.date,
    platform: entry.platform,
    campaign: entry.campaign,
    spend: Number(entry.spend) || 0,
    currency: entry.currency || "gbp",
    notes: entry.notes || null,
  };
}

function buildFunnel(events) {
  const actorsByStage = new Map(FUNNEL_STAGES.map((stage) => [stage, new Set()]));

  for (const event of events) {
    if (!actorsByStage.has(event.eventName)) continue;
    const actorId = event.uid || event.anonymousSessionId;
    if (!actorId) continue;
    actorsByStage.get(event.eventName).add(actorId);
  }

  let previousCount = null;
  return FUNNEL_STAGES.map((stage) => {
    const count = actorsByStage.get(stage).size;
    const conversionFromPrevious = previousCount ? count / previousCount : previousCount === null ? null : 0;
    const dropOffPct = conversionFromPrevious === null ? null : 1 - conversionFromPrevious;
    previousCount = count;
    return { stage, count, conversionFromPrevious, dropOffPct };
  });
}

function campaignKey(source) {
  source = attributionTouch(source);
  const campaign = (source?.utm_campaign || "").trim().toLowerCase();
  const utmSource = (source?.utm_source || "").trim().toLowerCase();
  return campaign || utmSource || "unattributed";
}

function attributionTouch(source) {
  return source?.firstTouch || source?.lastTouch || source || {};
}

function buildAdPerformance(events, customers, paidCustomersInRange, adSpendEntries) {
  const groups = new Map();

  function ensureGroup(key, sample) {
    sample = attributionTouch(sample);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        campaign: sample?.utm_campaign || (key === "unattributed" ? null : key),
        source: sample?.utm_source || null,
        visitors: new Set(),
        signups: new Set(),
        paidCustomers: new Set(),
        revenue: 0,
        spend: 0,
      });
    }
    return groups.get(key);
  }

  for (const event of events) {
    if (event.eventName !== "landing_page_view") continue;
    const key = campaignKey(event);
    const actorId = event.uid || event.anonymousSessionId;
    if (!actorId) continue;
    ensureGroup(key, event).visitors.add(actorId);
  }

  for (const customer of customers) {
    const key = campaignKey(customer.attribution);
    const group = ensureGroup(key, customer.attribution);
    group.signups.add(customer.uid);
  }

  for (const customer of paidCustomersInRange) {
    const key = campaignKey(customer.attribution);
    const group = ensureGroup(key, customer.attribution);
    group.paidCustomers.add(customer.uid);
    // Convert pence (totalPaid) to pounds so it matches adSpend.spend's unit.
    group.revenue += (Number(customer.totalPaid) || 0) / 100;
  }

  for (const entry of adSpendEntries) {
    const key = (entry.campaign || "").trim().toLowerCase() || "unattributed";
    const group = groups.get(key) || ensureGroup(key, { utm_campaign: entry.campaign });
    group.spend += Number(entry.spend) || 0;
  }

  return Array.from(groups.values())
    .map((group) => {
      const visitors = group.visitors.size;
      const signups = group.signups.size;
      const paid = group.paidCustomers.size;
      return {
        campaign: group.campaign || "Unattributed",
        source: group.source,
        visitors,
        signups,
        paidCustomers: paid,
        revenue: group.revenue,
        spend: group.spend,
        costPerSignup: group.spend > 0 && signups > 0 ? group.spend / signups : null,
        cac: group.spend > 0 && paid > 0 ? group.spend / paid : null,
        signupConversionRate: visitors > 0 ? signups / visitors : null,
        paidConversionRate: signups > 0 ? paid / signups : null,
        roas: group.spend > 0 ? group.revenue / group.spend : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.signups - a.signups);
}
