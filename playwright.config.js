import { defineConfig, devices } from "@playwright/test";

process.env.EMAIL_SERVICE_MODE = "mock";

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
