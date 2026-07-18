import { expect, test } from "@playwright/test";

function addCalendarDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

test("calculator is private-by-design, accessible and produces the dominant result", async ({ page, context }) => {
  await page.route(/https:\/\/[^/]*tawk\.to\//, (route) => route.abort("blockedbyclient"));

  await page.goto("/tools/payday-cashflow-calculator");
  await expect(page).toHaveTitle("Payday Cashflow Calculator | ClearTill");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.cleartill.money/tools/payday-cashflow-calculator");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payday cashflow calculator");

  const cookiesBeforeInteraction = await context.cookies();
  await page.evaluate(() => {
    window.__calculatorStorageWrites = [];
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function calculatorStorageGuard(key, value) {
      window.__calculatorStorageWrites.push({ storage: this === window.localStorage ? "local" : "session", key });
      return originalSetItem.call(this, key, value);
    };
  });

  const interactionRequests = [];
  await page.route("**/*", async (route) => {
    interactionRequests.push({ url: route.request().url(), method: route.request().method(), body: route.request().postData() });
    await route.abort("blockedbyclient");
  });

  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Check the highlighted fields and calculate again.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Cash available now" })).toBeFocused();

  const minimumDate = await page.getByRole("textbox", { name: "Next payday date" }).getAttribute("min");
  const futureDate = addCalendarDays(minimumDate, 11);
  await page.getByRole("textbox", { name: "Cash available now" }).fill("300");
  await page.getByRole("textbox", { name: "Next payday date" }).fill(futureDate);
  await page.getByRole("button", { name: "Calculate" }).click();

  const result = page.getByRole("status");
  await expect(result).toBeFocused();
  await expect(result.getByText("Available per day until payday")).toBeVisible();
  await expect(result.locator(".calculator-result-amount")).toHaveText("£25.00");
  await expect(result.getByText("£300.00 ÷ 12 days = £25.00 per day.")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/payday-cashflow-calculator$/);

  expect(interactionRequests).toEqual([]);
  const storageWrites = await page.evaluate(() => window.__calculatorStorageWrites);
  expect(storageWrites).toEqual([]);
  expect(await context.cookies()).toEqual(cookiesBeforeInteraction);
  const transmitted = JSON.stringify(interactionRequests);
  for (const privateValue of ["300", futureDate]) {
    expect(transmitted).not.toContain(privateValue);
  }

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Cash available now" })).toHaveValue("");

  await page.unroute("**/*");
  await page.getByRole("textbox", { name: "Cash available now" }).fill("123.45");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Cash available now" })).toHaveValue("");
});

test("calculator actions work from the keyboard and expose validation and live-result semantics", async ({ page }) => {
  await page.goto("/tools/payday-cashflow-calculator");
  const calculateButton = page.getByRole("button", { name: "Calculate" });
  await calculateButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Check the highlighted fields and calculate again.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Cash available now" })).toHaveAttribute("aria-describedby", /availableCash-error/);
  await expect(page.getByRole("textbox", { name: "Cash available now" })).toBeFocused();

  const minimumDate = await page.getByRole("textbox", { name: "Next payday date" }).getAttribute("min");
  await page.getByRole("textbox", { name: "Cash available now" }).fill("100");
  await page.getByRole("textbox", { name: "Next payday date" }).fill(minimumDate);
  await calculateButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");

  const resetButton = page.getByRole("button", { name: "Reset" });
  await resetButton.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("calculator schema is singular by type and contains no rating claims", async ({ page }) => {
  await page.goto("/tools/payday-cashflow-calculator");
  const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent)));
  expect(schemas.filter((schema) => schema["@type"] === "BreadcrumbList")).toHaveLength(1);
  expect(schemas.filter((schema) => schema["@type"] === "WebApplication")).toHaveLength(1);
  expect(JSON.stringify(schemas)).not.toMatch(/AggregateRating|ratingValue|review|numberOfUsers/i);
});

test("Journal exposes the free tool and linkable category filters", async ({ page }) => {
  await page.goto("/blog");
  await expect(page.getByRole("heading", { name: "Put the method to work" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Payday cashflow calculator" })).toHaveAttribute("href", "/tools/payday-cashflow-calculator");
  await page.getByRole("link", { name: /01 Money basics/ }).click();
  await expect(page).toHaveURL(/topic=money-basics/);
  await expect(page.getByRole("link", { name: "Money basics", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /How much can I spend before payday/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Budgeting Without Open Banking/ })).toBeVisible();
});

test("Journal topic filtering is server rendered without JavaScript and unknown topics fall back", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("/blog?topic=money-basics");
  await expect(page.getByRole("link", { name: "Money basics", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /Budgeting Without Open Banking/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /How much can I spend before payday/ })).toHaveCount(0);
  const toolCard = page.locator(".blog-tool-card");
  await expect(toolCard).toContainText("Free tool");
  await expect(toolCard).not.toContainText(/min read|Published/i);

  await page.goto("/blog?topic=not-a-real-topic");
  await expect(page.getByRole("link", { name: "All guides", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /Budgeting Without Open Banking/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /How much can I spend before payday/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Budgeting with irregular income/ })).toBeVisible();

  await context.close();
});

for (const width of [375, 768, 1440]) {
  test(`public linkable routes have no page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/blog", "/blog/budgeting-without-open-banking", "/tools/payday-cashflow-calculator"]) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, page: document.documentElement.scrollWidth }));
      expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    }
  });
}
