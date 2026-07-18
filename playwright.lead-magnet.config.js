import { defineConfig, devices } from "@playwright/test";

// Public funnel UI tests must never inherit production Firebase or delivery
// credentials from .env.local. The API calls they exercise are intercepted in
// the spec; these deliberately invalid test values make accidental access fail
// closed while still allowing the Firebase client auth observer to initialise.
Object.assign(process.env, {
  LEAD_MAGNET_UI_ONLY: "1",
  NEXT_DIST_DIR: ".next-e2e-lead-magnet",
  EMAIL_SERVICE_MODE: "mock",
  FIREBASE_PROJECT_ID: "cleartill-lead-magnet-e2e",
  FIREBASE_CLIENT_EMAIL: "lead-magnet-e2e@example.invalid",
  FIREBASE_PRIVATE_KEY: "invalid-test-private-key",
  NEXT_PUBLIC_FIREBASE_API_KEY: "invalid-test-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "cleartill-lead-magnet-e2e.invalid",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "cleartill-lead-magnet-e2e",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "cleartill-lead-magnet-e2e.invalid",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:leadmagnete2e",
});

const port = 3021;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "lead-magnet.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
