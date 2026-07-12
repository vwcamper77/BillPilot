import { defineConfig } from "@playwright/test";

process.env.EMAIL_SERVICE_MODE = "mock";

export default defineConfig({
  testDir: "./tests/unit",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
