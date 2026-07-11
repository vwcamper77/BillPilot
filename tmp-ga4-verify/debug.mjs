import { chromium } from "@playwright/test";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const SCRATCHPAD_DIR = "c:\\Users\\dellxps\\AppData\\Local\\Temp\\claude\\c--Users-dellxps-BillPilot\\f7b08603-e209-494a-a94a-91e7186a41d1\\scratchpad";

async function main() {
  const userDataDir = path.join(SCRATCHPAD_DIR, "chrome-profile-debug");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on("console", (msg) => console.log("BROWSER:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  context.on("request", (req) => {
    if (req.url().includes("google-analytics.com")) {
      console.log("GA-REQUEST URL:", req.url());
      console.log("GA-REQUEST BODY:", req.postData());
    }
  });

  await page.goto(`${BASE_URL}/billing`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const gtagType = await page.evaluate(() => typeof window.gtag);
  console.log("typeof window.gtag:", gtagType);
  const dataLayerLen = await page.evaluate(() => (window.dataLayer || []).length);
  console.log("dataLayer length:", dataLayerLen);

  console.log("Clicking Continue with Google...");
  const popupPromise = context.waitForEvent("page", { timeout: 10000 });
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  const popup = await popupPromise.catch((e) => { console.log("no popup:", e.message); return null; });
  if (popup) {
    console.log("popup url:", popup.url());
    await popup.waitForTimeout(1000);
    await popup.close().catch(() => undefined);
  }
  await page.waitForTimeout(2000);

  const errorText = await page.locator(".billing-error").textContent().catch(() => null);
  console.log("error text on page:", errorText);

  const bodyText = await page.locator("body").innerText();
  console.log("BODY TEXT (first 600 chars):", bodyText.slice(0, 600));

  await page.waitForTimeout(3000);
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
