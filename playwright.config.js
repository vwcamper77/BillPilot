import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

process.env.EMAIL_SERVICE_MODE = "mock";

// Client-only specs intercept Firebase's network calls, so keep those tests
// runnable without borrowing production Firebase configuration.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "playwright-api-key";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "cleartill-playwright.test";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "cleartill-hydration-test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= "cleartill-hydration-test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= "123456789";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:123456789:web:playwright";

const testPort = process.env.PLAYWRIGHT_PORT || "3000";
const testBaseUrl = `http://localhost:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [["list"]],
  use: {
    baseURL: testBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command: testPort === "3000" ? "npm run dev" : `npx next dev -p ${testPort}`,
    url: testBaseUrl,
    // Always start our own server rather than trusting whatever else might
    // already be bound to :3000 in this environment.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
