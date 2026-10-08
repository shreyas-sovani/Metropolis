import { expect, test, type Page } from "@playwright/test";

async function quiet(page: Page) {
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111, armed: 4, poolAvailable: 12 },
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

const shots = [
  ["v7-step1", "/app", "Open my practice account"],
  ["v7-step2", "/app?shot=owning", "Take ownership"],
  ["v7-step3", "/app?shot=choosing", "Sign and turn on protection"],
  ["v7-receipt", "/app?shot=receipt", "Lifeline protected your position."],
] as const;

for (const width of [390, 1440]) {
  test(`onboarding at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await quiet(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, path, text] of shots) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
      if (name === "v7-receipt") await page.waitForTimeout(800);
      await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
      await page.screenshot({ path: `e2e/artifacts/${name}-${width}.png`, fullPage: true });
    }
  });
}
