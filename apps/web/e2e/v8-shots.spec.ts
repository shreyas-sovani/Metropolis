import { expect, test, type Page } from "@playwright/test";

async function quiet(page: Page) {
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: Date.now() - 1_000, lastBlock: 68909760, armed: 4, poolAvailable: 12 },
    }),
  );
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0 } }));
  await page.route("**/api/turnstile", (route) => route.fulfill({ json: { siteKey: "shot" } }));
  await page.route(/challenges\.cloudflare\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.turnstile={render(el,opts){setTimeout(()=>opts.callback('shot'),0);return 'w'},remove(){},reset(){}}",
    }),
  );
}

test("dashboard screenshots", async ({ page }) => {
  test.setTimeout(90_000);
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?shot=dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Your protection" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Lifeline added 61 AUSD")).toBeVisible();
  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: "e2e/artifacts/v8-dashboard-1440.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "e2e/artifacts/v8-dashboard-390.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?shot=withdraw", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Withdraw idle AUSD")).toBeVisible({ timeout: 20_000 });
  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: "e2e/artifacts/v8-withdraw-1440.png", fullPage: true });
});
