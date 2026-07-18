import { expect, test } from "@playwright/test";
import {
  isDismissalSuppressed,
  isLeadMagnetExcludedRoute,
  isValidGoogleSheetCopyUrl,
  LEAD_MAGNET_CONSENT_TEXT,
  LEAD_MAGNET_CONSENT_VERSION,
  LEAD_MAGNET_TIMING,
  normaliseLeadEmail,
  sanitiseLeadAttribution,
} from "../../lib/leadMagnet.js";
import {
  LeadMagnetValidationError,
  processLeadMagnetSubmission,
  validateLeadMagnetBody,
} from "../../lib/leadMagnet.server.js";
import { buildLeadMagnetEmail } from "../../lib/email/leadMagnetTemplate.js";

test("normalises valid email and rejects malformed or oversized addresses", () => {
  expect(normaliseLeadEmail("  PERSON@Example.COM ")).toBe("person@example.com");
  expect(normaliseLeadEmail("not-an-email")).toBeNull();
  expect(normaliseLeadEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
});

test("all private, auth, legal, billing and preview routes are excluded", () => {
  for (const route of ["/dashboard", "/dashboard/bills-income", "/account", "/signin", "/start", "/access/claim", "/trial/claim", "/checkout", "/billing/success", "/admin/analytics", "/privacy", "/terms", "/security", "/unsubscribe"]) {
    expect(isLeadMagnetExcludedRoute(route), route).toBe(true);
  }
  expect(isLeadMagnetExcludedRoute("/")) .toBe(false);
  expect(isLeadMagnetExcludedRoute("/free-cash-position-sheet")).toBe(false);
});

test("fourteen-day dismissal policy expires at the boundary", () => {
  const now = Date.UTC(2026, 6, 18);
  expect(isDismissalSuppressed(now - LEAD_MAGNET_TIMING.dismissalMs + 1, now)).toBe(true);
  expect(isDismissalSuppressed(now - LEAD_MAGNET_TIMING.dismissalMs, now)).toBe(false);
});

test("only a Google Sheets forced-copy URL is accepted", () => {
  expect(isValidGoogleSheetCopyUrl("https://docs.google.com/spreadsheets/d/abc123/copy")).toBe(true);
  expect(isValidGoogleSheetCopyUrl("https://docs.google.com/spreadsheets/d/abc123/edit")).toBe(false);
  expect(isValidGoogleSheetCopyUrl("javascript:alert(1)")).toBe(false);
  expect(isValidGoogleSheetCopyUrl("https://example.com/spreadsheets/d/abc123/copy")).toBe(false);
  expect(isValidGoogleSheetCopyUrl("")).toBe(false);
});

test("server validation keeps consent explicit and attribution bounded", () => {
  const result = validateLeadMagnetBody({
    email: " Lead@Example.com ",
    marketingConsent: "true",
    attribution: { sourceRoute: "/free-cash-position-sheet", utmCampaign: "x".repeat(300) },
  });
  expect(result.email).toBe("lead@example.com");
  expect(result.marketingConsent).toBe(false);
  expect(result.attribution.utmCampaign).toHaveLength(128);
  expect(sanitiseLeadAttribution(null).sourceRoute).toBe("/");
  expect(LEAD_MAGNET_CONSENT_VERSION).toContain("2026-07-18");
  expect(LEAD_MAGNET_CONSENT_TEXT).toContain("This is optional.");
});

test("honeypot submissions are accepted silently without rate limit or fulfilment", async () => {
  let called = false;
  const result = await processLeadMagnetSubmission(
    { body: { email: "bot@example.com", company: "Spam Ltd" }, ip: "192.0.2.1" },
    { checkRateLimit: async () => { called = true; }, fulfil: async () => { called = true; } },
  );
  expect(result).toEqual({ ok: true, accepted: true });
  expect(called).toBe(false);
});

test("submission rate limits by separate IP and normalised-email hashes before fulfilment", async () => {
  const buckets = [];
  let fulfilled;
  await processLeadMagnetSubmission(
    { body: { email: " Lead@Example.com ", marketingConsent: true }, ip: "192.0.2.2" },
    {
      checkRateLimit: async (bucket, key, policy) => buckets.push({ bucket, key, policy }),
      fulfil: async (submission) => { fulfilled = submission; },
    },
  );
  expect(buckets.map(({ bucket }) => bucket).sort()).toEqual(["lead-magnet-email", "lead-magnet-ip"]);
  expect(buckets[0].key).toMatch(/^[a-f0-9]{64}$/);
  expect(buckets[1].key).toMatch(/^[a-f0-9]{64}$/);
  expect(fulfilled.email).toBe("lead@example.com");
  expect(fulfilled.marketingConsent).toBe(true);
});

test("invalid email fails before rate limiting or fulfilment", async () => {
  await expect(processLeadMagnetSubmission({ body: { email: "bad" }, ip: "192.0.2.3" }, {
    checkRateLimit: async () => { throw new Error("should not run"); },
    fulfil: async () => { throw new Error("should not run"); },
  })).rejects.toBeInstanceOf(LeadMagnetValidationError);
});

test("transactional email contains all fulfilment, entity, support and privacy links", () => {
  const email = buildLeadMagnetEmail({
    landingPageUrl: "https://www.cleartill.money/free-cash-position-sheet",
    spreadsheetUrl: "https://www.cleartill.money/downloads/cleartill-free-cash-position-sheet.xlsx",
    guideUrl: "https://www.cleartill.money/guides/cleartill-bank-balance-reset-guide.pdf",
  });
  expect(email.text).toContain("GMBF Ventures Ltd");
  expect(email.text).toContain("hello@cleartill.money");
  expect(email.text).toContain("/privacy");
  expect(email.text).toContain(".xlsx");
  expect(email.text).toContain(".pdf");
});
