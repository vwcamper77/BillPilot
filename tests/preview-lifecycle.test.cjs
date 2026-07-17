const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizePreviewRecord, overlayPreviewAccess } = require("../lib/previewPolicy.cjs");
const { EMAIL_CLAIM_LEASE_MS, EMAIL_MAX_ATTEMPTS, decideEmailClaim, failureStatusForAttempt } = require("../lib/emailDeliveryPolicy.cjs");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("preview start is authenticated, server-derived, complete-position gated, transactional and idempotent", () => {
  const route = read("app/api/preview/start/route.js");
  const lifecycle = read("lib/previewLifecycle.server.js");
  assert.match(route, /verifyRequestUser\(request\)/);
  assert.match(route, /sign_in_provider === "anonymous"/);
  assert.doesNotMatch(route, /body\?\.(uid|startedAt|endsAt)|request\.json/);
  assert.match(lifecycle, /hasCompletePosition[\s\S]*validBalance[\s\S]*validPayday[\s\S]*hasCost/);
  assert.match(lifecycle, /runTransaction[\s\S]*existingSnap\.exists[\s\S]*created: false/);
  assert.match(lifecycle, /transaction\.create\(previewRef, record\)/);
  assert.match(lifecycle, /source: "first_complete_position"/);
});

test("normalized access gives paid records priority and makes expired preview read-only", () => {
  const resolver = read("lib/entitlementResolver.server.js");
  assert.match(resolver, /overlayPreviewAccess/);
  assert.match(resolver, /previewUsed: preview\.used/);
  assert.match(read("lib/billing/access.js"), /ENTITLED_SUBSCRIPTION_STATUSES = new Set\(\["trialing", "active"\]\)/);
});

test("server time expires a still-active preview without hiding its data", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const preview = normalizePreviewRecord({ status: "active", startedAt: "2026-07-09T12:00:00.000Z", endsAt: "2026-07-16T12:00:00.000Z" }, now);
  assert.equal(preview.status, "expired");
  assert.equal(preview.active, false);
  const expired = overlayPreviewAccess({ decision: { hasAccess: false, accessType: "none", reason: "no_entitlement" }, preview, isAuthenticated: true, hasPriorCommercialAccess: false });
  assert.equal(expired.hasAccess, false);
  assert.equal(expired.canEdit, false);
  assert.equal(expired.accessType, "read_only");
  const rules = read("firestore.rules");
  assert.match(rules, /status == "active"[\s\S]*endsAt > request\.time/);
  assert.match(rules, /match \/users\/\{userId\}[\s\S]*allow read: if isOwner\(userId\)/);
});

test("paid, founding, manual and legacy access outrank an expired preview", () => {
  const preview = normalizePreviewRecord({ status: "active", endsAt: "2026-07-16T12:00:00.000Z" }, new Date("2026-07-17T12:00:00.000Z"));
  for (const accessType of ["stripe_subscription_active", "founding_member", "manually_granted", "legacy_paid"]) {
    const access = overlayPreviewAccess({ decision: { hasAccess: true, accessType, reason: "paid" }, preview, isAuthenticated: true, hasPriorCommercialAccess: true });
    assert.equal(access.hasAccess, true);
    assert.equal(access.canEdit, true);
    assert.equal(access.accessType, accessType);
  }
});

test("financial APIs reject expired preview writes while onboarding remains possible", () => {
  const guard = read("lib/financialAccess.server.js");
  assert.match(guard, /if \(access\.canEdit\) return access/);
  assert.match(guard, /access\/read-only/);
  for (const route of ["bills", "forecast", "large-costs", "income-events", "settings"]) {
    assert.match(read(`app/api/dashboard/${route}/route.js`), /assertCanEditFinancialData/);
  }
  const rules = read("firestore.rules");
  assert.match(rules, /previewIsActive\(userId\)[\s\S]*!previewExists\(userId\) && onboardingIsOpen\(userId\)/);
  assert.match(rules, /get\(path\)\.data\.endsAt > request\.time/);
  assert.match(guard, /inspectCompletePosition[\s\S]*preview\/finalization-required/);
});

test("complete pre-preview state cannot enter indefinite BAU and finalization retries cannot extend", () => {
  const dashboard = read("app/dashboard/HomeDashboard.jsx");
  const lifecycle = read("lib/previewLifecycle.server.js");
  const profile = read("lib/customerProfile.server.js");
  assert.match(dashboard, /setupStep !== 4[\s\S]*handleCompleteFirstPosition/);
  assert.match(dashboard, /canStartPreview[\s\S]*localStorage/);
  assert.match(lifecycle, /existingSnap\.exists[\s\S]*created: false/);
  assert.match(lifecycle, /transaction\.create\(previewRef, record\)/);
  assert.match(profile, /status: "incomplete"[\s\S]*writeEndsAt/);
});

test("preview activation and account acquisition never invoke Stripe", () => {
  const sources = ["app/api/preview/start/route.js", "lib/previewLifecycle.server.js", "app/components/AuthJourney.jsx"].map(read).join("\n");
  assert.doesNotMatch(sources, /api\/stripe|checkout\.sessions|trial_period_days/i);
});

test("paid checkout validates monthly and annual plans without a Stripe trial", () => {
  const route = read("app/api/stripe/subscription-checkout/route.js");
  const params = read("lib/subscriptionCheckout.js");
  const flags = read("lib/subscriptionFlags.js");
  assert.match(route, /\["monthly", "annual"\]\.includes\(plan\)/);
  assert.match(route, /getSubscriptionPriceId\(plan\)/);
  assert.match(flags, /STRIPE_MONTHLY_PRICE_ID/);
  assert.match(flags, /STRIPE_ANNUAL_PRICE_ID/);
  assert.doesNotMatch(`${route}\n${params}`, /price_1[A-Za-z0-9]+/);
  assert.doesNotMatch(params, /trial_period_days/);
  assert.match(params, /flow: "paid_upgrade"/);
});

test("webhook conversion retains preview and preserves legacy Stripe trial handling", () => {
  const webhook = read("app/api/stripe/webhook/route.js");
  const lifecycle = read("lib/previewLifecycle.server.js");
  assert.match(webhook, /isPaidUpgrade[\s\S]*markPreviewConverted/);
  assert.match(webhook, /else \{[\s\S]*recordVerifiedTrial/);
  assert.match(lifecycle, /status: "converted"[\s\S]*convertedAt/);
  assert.doesNotMatch(lifecycle, /\.delete\(/);
});

test("all lifecycle emails use the idempotent delivery ledger and protect financial content", () => {
  const emails = read("lib/previewEmails.server.js");
  const scheduler = read("app/api/scheduler/route.js");
  for (const type of ["account_created", "onboarding_incomplete", "preview_started", "preview_balance_check", "preview_cost_check", "preview_ending", "preview_expired"]) {
    assert.match(emails, new RegExp(`${type}:`));
  }
  assert.match(emails, /claimEmailDelivery/);
  assert.match(emails, /markEmailDelivery/);
  assert.match(scheduler, /!previewSnapshot\.exists[\s\S]*!completeness\.complete/);
  assert.match(read("lib/previewLifecycle.server.js"), /staleHours >= 36/);
  for (const subject of ["Your ClearTill account is ready", "Your ClearTill live preview has started", "Has your balance changed?", "Is there anything still to add?", "Your live ClearTill preview ends tomorrow", "Your ClearTill position is now paused"]) {
    assert.doesNotMatch(subject, /£|\$|€/);
  }
  assert.match(read("lib/email.js"), /includeAmounts = false/);
});

test("email claim policy retries safely and stops permanent failures", () => {
  const now = Date.parse("2026-07-17T12:00:00.000Z");
  assert.deepEqual(decideEmailClaim({ status: "sent", attempts: 1 }, now), { ok: false, reason: "duplicate" });
  assert.equal(decideEmailClaim({ status: "failed", attempts: 1 }, now).attempts, 2);
  assert.equal(decideEmailClaim({ status: "claimed", attempts: 1, leaseExpiresAt: new Date(now - 1) }, now).recovery, "stale_claim");
  assert.deepEqual(decideEmailClaim({ status: "claimed", attempts: 1, leaseExpiresAt: new Date(now + EMAIL_CLAIM_LEASE_MS) }, now), { ok: false, reason: "in_progress" });
  assert.deepEqual(decideEmailClaim({ status: "failed", attempts: EMAIL_MAX_ATTEMPTS }, now), { ok: false, reason: "max_attempts" });
  assert.equal(failureStatusForAttempt(EMAIL_MAX_ATTEMPTS), "permanent_failure");
  const delivery = read("lib/email.js");
  const scheduler = read("app/api/scheduler/route.js");
  assert.match(delivery, /runTransaction[\s\S]*claimToken[\s\S]*leaseExpiresAt/);
  assert.match(scheduler, /type: "account_created"[\s\S]*type: "preview_started"/);
  assert.match(read("lib/previewLifecycle.server.js"), /day >= 6[\s\S]*day >= 4[\s\S]*day >= 2/);
});

test("account-created email uses trusted Firebase identity and cannot start preview or Stripe", () => {
  const route = read("app/api/track/route.js");
  const profile = read("lib/customerProfile.server.js");
  assert.match(route, /getAdminAuth\(\)\.getUser\(uid\)/);
  assert.match(route, /email: authUser\.email/);
  assert.doesNotMatch(route, /body\?\.email/);
  assert.match(profile, /accountCreatedAt[\s\S]*writeEndsAt/);
  assert.doesNotMatch(route, /preview\/start|startPreviewForUid|stripe/i);
});

test("new-user public copy contains only the no-card preview and current prices", () => {
  const publicJourney = ["app/page.jsx", "app/start/page.jsx", "app/pricing/page.jsx", "app/blog/page.jsx", "app/blog/[slug]/page.jsx", "app/blog/posts.js", "app/billing/subscribe/page.jsx", "app/billing/subscribe/success/SubscriptionActivation.jsx"].map(read).join("\n");
  assert.doesNotMatch(publicJourney, /£1\.99|7-day free trial|intent=trial/);
  assert.match(publicJourney, /£3\.99/);
  assert.match(publicJourney, /£24\.99/);
  assert.match(publicJourney, /No card required|no-card/i);
});

test("preview analytics are allowlisted and sensitive values remain blocked", () => {
  const constants = read("lib/analytics/constants.js");
  const server = read("lib/analytics.js");
  for (const event of ["preview_start_requested", "preview_started", "preview_reminder_sent", "preview_reminder_opened", "balance_updated_during_preview", "position_recalculated_during_preview", "preview_expired", "upgrade_offer_viewed", "upgrade_checkout_started", "subscription_started"]) {
    assert.match(constants, new RegExp(`"${event}"`));
    assert.match(server, new RegExp(`"${event}"`));
  }
  assert.match(server, /BLOCKED_KEYS[\s\S]*"amount"[\s\S]*"balance"[\s\S]*"email"/);
  assert.match(read("lib/customerProfile.server.js"), /BLOCKED_METADATA_KEY_PATTERN/);
});
