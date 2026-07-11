// One-off production-GA4-evidence script for the auth-gate funnel events.
// Run against `npm run dev` using the real .env.local (real Firebase + real GA4 measurement ID),
// so gtag.js fires genuine hits to google-analytics.com identical to what the deployed site would send.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const evidence = [];
const stamp = Date.now();
const testEmail = `cleartill.qa.${stamp}@mailinator.com`;
const testPassword = "QaTest12345!";

function recordHit(scenario, url, sharedParams, hitParams) {
  const merged = { ...sharedParams, ...hitParams };
  if (!merged.en) return;
  evidence.push({
    scenario,
    capturedAt: new Date().toISOString(),
    eventName: merged.en,
    method: merged["ep.method"] || null,
    context: merged["ep.context"] || null,
    error_type: merged["ep.error_type"] || null,
    measurementId: merged.tid || null,
    fullUrl: url,
  });
  console.log(`[GA4] scenario="${scenario}" en=${merged.en} method=${merged["ep.method"] || "-"} context=${merged["ep.context"] || "-"} error_type=${merged["ep.error_type"] || "-"}`);
}

// gtag.js batches several events fired in quick succession into one POST to /g/collect:
// shared identifiers (tid, cid, etc.) live in the URL query string, and each individual
// event is one newline-separated line in the POST body — so both must be parsed.
function recordGaRequest(scenario, request) {
  const url = request.url();
  const parsed = new URL(url);
  if (!parsed.hostname.includes("google-analytics.com")) return;
  const sharedParams = Object.fromEntries(parsed.searchParams.entries());

  recordHit(scenario, url, sharedParams, {});

  const postData = request.postData();
  if (!postData) return;
  for (const line of postData.split("\n")) {
    if (!line.trim()) continue;
    const hitParams = Object.fromEntries(new URLSearchParams(line).entries());
    recordHit(scenario, url, sharedParams, hitParams);
  }
}

let currentScenario = "startup";

const SCRATCHPAD_DIR = "c:\\Users\\dellxps\\AppData\\Local\\Temp\\claude\\c--Users-dellxps-BillPilot\\f7b08603-e209-494a-a94a-91e7186a41d1\\scratchpad";

async function main() {
  const userDataDir = path.join(SCRATCHPAD_DIR, "chrome-profile-runA");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  context.on("request", (req) => recordGaRequest(currentScenario, req));
  context.on("page", (popup) => {
    popup.on("request", (req) => recordGaRequest(currentScenario, req));
  });

  const page = context.pages()[0] || (await context.newPage());

  // gtag.js batches hits and only flushes on the next page unload/navigation. A
  // same-tick `window.location.href` redirect to a cross-origin URL (Stripe) can
  // race past that flush before Playwright's CDP session captures it, so hold the
  // real navigation open for a couple of seconds to let the pending batch send.
  await page.route("**://checkout.stripe.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });

  // --- Scenario: Google popup opened then closed ---
  currentScenario = "google_popup_opened_then_closed";
  await page.goto(`${BASE_URL}/billing`, { waitUntil: "domcontentloaded" });
  const popupPromise = context.waitForEvent("page", { timeout: 10000 });
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  const popup = await popupPromise;
  await popup.waitForTimeout(800);
  await popup.close().catch(() => undefined);
  await page.waitForSelector(".billing-error", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log("=== scenario done: google_popup_opened_then_closed ===");

  // --- Scenario: New email registration ---
  currentScenario = "new_email_registration";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.fill("#billing-email", testEmail);
  await page.fill("#billing-password", testPassword);
  await page.getByRole("button", { name: /Continue with email/i }).click();
  await page.waitForSelector("text=Ready to activate your access", { timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log("=== scenario done: new_email_registration ===");

  // --- Scenario: Successful progression into Stripe ---
  currentScenario = "checkout_progression_to_stripe";
  await page.getByRole("button", { name: /Pay £5 securely with Stripe/i }).click();
  await page.waitForURL(/stripe\.com|checkout\.stripe/, { timeout: 20000 }).catch(() => undefined);
  console.log("Landed on:", page.url());
  await page.waitForTimeout(2500);
  console.log("=== scenario done: checkout_progression_to_stripe ===");

  // --- Sign out ---
  await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForTimeout(2500);

  // --- Scenario: Existing email login ---
  currentScenario = "existing_email_login";
  await page.goto(`${BASE_URL}/billing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /I already have an account/i }).click();
  await page.fill("#billing-email", testEmail);
  await page.fill("#billing-password", testPassword);
  await page.getByRole("button", { name: /Sign in and continue/i }).click();
  await page.waitForSelector("text=Ready to activate your access", { timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log("=== scenario done: existing_email_login ===");

  // --- Sign out again ---
  await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForTimeout(2500);

  // --- Scenario: Authentication failure (wrong password) ---
  currentScenario = "authentication_failure";
  await page.goto(`${BASE_URL}/billing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /I already have an account/i }).click();
  await page.fill("#billing-email", testEmail);
  await page.fill("#billing-password", "TotallyWrongPassword!");
  await page.getByRole("button", { name: /Sign in and continue/i }).click();
  await page.waitForSelector(".billing-error", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  console.log("=== scenario done: authentication_failure ===");

  // Force one more navigation so gtag flushes the trailing auth_failed batch.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const outFile = path.join(SCRATCHPAD_DIR, "runA-evidence.json");
  fs.writeFileSync(outFile, JSON.stringify({ testEmail, evidence }, null, 2));
  console.log("Evidence written to", outFile);

  await context.close();
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
