import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "compact", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
];

test("irregular-income article uses the shared dashboard hierarchy at all viewports", async ({ page }) => {
  await page.goto("/blog/budgeting-irregular-income-no-payday");
  const rejectAnalytics = page.getByRole("button", { name: "No thanks" });
  if (await rejectAnalytics.isVisible()) await rejectAnalytics.click();
  await expect(page.locator(".article-dashboard-preview")).toBeVisible();
  await expect(page.locator(".preview-result-card")).toContainText("Available before your next reliable payment");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${viewport.name} article horizontal overflow`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.codex-artifacts/cleartill-redesign/blog-${viewport.name}-viewport.png` });
  }
});
