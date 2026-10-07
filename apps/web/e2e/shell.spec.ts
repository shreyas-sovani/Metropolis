import { expect, test } from "@playwright/test";

const routes = ["/", "/lifeline", "/twins", "/judges", "/replay", "/methodology", "/a/0x0000000000000000000000000000000000000001", "/dev/ui"];

const headerLinks = ["Market risk", "Check an address", "Proof", "Developers", "Judge tour", "Protect a position"];
const footerLinks = ["Protect a position", "Market risk", "Check an address", "Developers", "Twins", "A real liquidation", "Methodology", "Judge tour", "Evidence", "How it works", "Security", "FAQ"];

const emptyRadar = {
  chainId: 143,
  blockNumber: "1",
  calibrated: true,
  headline: { openInterestMicro: "0", atRiskNotionalMicro: "0", atRiskCount: 0, idleMicro: "0" },
  markets: [],
  positions: [],
};

async function silenceApis(page: import("@playwright/test").Page) {
  await page.route("http://localhost:3000/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/radar")) return route.fulfill({ json: emptyRadar });
    if (url.includes("/api/ops-health")) {
      return route.fulfill({
        json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111, armed: 4, poolAvailable: 12 },
      });
    }
    if (url.includes("/api/twins")) return route.fulfill({ json: { pairs: [] } });
    if (url.includes("/api/account")) return route.fulfill({ json: { positions: [] } });
    if (url.includes("/api/liquidations")) return route.fulfill({ json: { latest: [] } });
    if (url.includes("/api/markets")) return route.fulfill({ json: { markets: [] } });
    if (url.includes("/api/saves")) return route.fulfill({ json: { count: 0 } });
    if (url.includes("/api/turnstile")) return route.fulfill({ json: {} });
    return route.fulfill({ json: {} });
  });
  await page.route(/challenges\.cloudflare\.com/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "window.turnstile={render(){return 'x'},remove(){}}" }));
}

for (const width of [390, 1440]) {
  for (const route of routes) {
    test(`${route} renders at ${width}px without console errors`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await silenceApis(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".site-header")).toBeVisible();
      const footer = page.getByRole("contentinfo");
      for (const name of footerLinks) {
        await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
      }
      if (width === 1440) {
        const header = page.locator(".site-header");
        for (const name of ["Market risk", "Check an address", "Proof", "Developers"]) {
          await expect(header.locator(".site-nav").getByRole("link", { name, exact: true })).toBeVisible();
        }
        await expect(header.locator(".site-tools").getByRole("link", { name: "Judge tour", exact: true })).toBeVisible();
        await expect(header.locator(".site-cta")).toBeVisible();
      } else {
        const menu = page.getByRole("button", { name: "Menu" });
        await expect(menu).toHaveAttribute("data-hydrated", "yes");
        await menu.click();
        const primary = page.getByRole("navigation", { name: "Primary" });
        for (const name of headerLinks) await expect(primary.getByRole("link", { name, exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      }
      await expect(footer).toContainText("Lifeline runs protection on Monad testnet. Market data is read live from Monad mainnet and never written to. Testnet tokens have no value.");
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
}

test("escape closes the mobile menu and returns focus to Menu", async ({ page }) => {
  await silenceApis(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const menu = page.getByRole("button", { name: "Menu" });
  await expect(menu).toHaveAttribute("data-hydrated", "yes");
  await menu.click();
  const market = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Market risk" });
  await expect(market).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(market).toBeHidden();
});

test("shell screenshots", async ({ page }) => {
  await silenceApis(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Don't get liquidated with money in your account." })).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/v3-shell-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: "e2e/artifacts/v3-shell-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/ui", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Interface" })).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/v3-ui-gallery-1440.png", fullPage: true });
});
