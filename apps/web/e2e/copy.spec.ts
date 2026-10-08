import { expect, test, type Page } from "@playwright/test";
import { MAINNET_EXAMPLE } from "../lib/bounties";
import { forbiddenHit } from "../lib/forbidden";

const ROUTES = [
  "/",
  "/radar",
  "/check",
  `/a/${MAINNET_EXAMPLE}?chain=143`,
  "/proof",
  "/twins",
  "/replay",
  "/methodology",
  "/developers",
  "/tour",
  "/tour/evidence",
  "/lifeline",
  "/judges",
  "/app",
  "/app?shot=owning",
  "/app?shot=choosing",
  "/app?shot=receipt",
  "/app?shot=dashboard",
  "/app?shot=withdraw",
];

const emptyRadar = {
  chainId: 143,
  blockNumber: "111275464",
  calibrated: true,
  headline: { openInterestMicro: "3150000000000", atRiskNotionalMicro: "274500000000", atRiskCount: 141, idleMicro: "127400000000" },
  markets: [],
  positions: [],
  saves: { count: 0 },
};

async function silenceApis(page: Page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.hostname.includes("localhost") && url.hostname !== "127.0.0.1") return route.continue();
    const path = url.pathname;
    if (path.includes("/api/radar")) return route.fulfill({ json: emptyRadar });
    if (path.includes("/api/ops-health")) {
      return route.fulfill({
        json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111275464, armed: 4, poolAvailable: 12 },
      });
    }
    if (path.includes("/api/twins")) return route.fulfill({ json: { pairs: [] } });
    if (path.includes("/api/account")) return route.fulfill({ json: { found: false, positions: [] } });
    if (path.includes("/api/liquidations")) return route.fulfill({ json: { latest: [], totals: { count: 0 } } });
    if (path.includes("/api/markets")) return route.fulfill({ json: { markets: [] } });
    if (path.includes("/api/saves")) return route.fulfill({ json: { count: 0, watched: 0 } });
    if (path.includes("/api/lifeline/claim")) return route.fulfill({ status: 503, json: { error: "empty", sandbox: true } });
    if (path.includes("/api/lifeline/sandbox-accounts")) {
      return route.fulfill({ json: { accounts: [{ proxy: "0x1111111111111111111111111111111111111111", distanceE6: "27000" }] } });
    }
    if (path.includes("/api/lifeline/sandbox")) {
      return route.fulfill({
        json: { txHash: "0x85fe2562", block: 20, addedCNS: "1000000", distBefore: "27000", distAfter: "60000" },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.route(/challenges\.cloudflare\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "window.turnstile={render(){return 'x'},remove(){}}" }),
  );
}

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    root.querySelectorAll("code, pre, script, style").forEach((node) => node.remove());
    return root.innerText;
  });
}

function expectClean(text: string, where: string) {
  const hit = forbiddenHit(text);
  expect(hit, `${where} shows “${hit}”`).toBeNull();
}

test.describe("visible copy", () => {
  test.beforeEach(async ({ page }) => {
    await silenceApis(page);
  });

  for (const route of ROUTES) {
    test(`${route} has no forbidden terms`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".site-header")).toBeVisible();
      expectClean(await visibleText(page), route);
    });
  }

  test("an empty pool opens demo mode in plain language", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/app?fault=pool", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", { name: "Open my practice account" });
    await expect(start).toHaveAttribute("data-ready", "yes");
    await start.click();
    await expect(page.getByTestId("sandbox")).toBeVisible();
    expectClean(await visibleText(page), "demo mode");
  });

  test("a rate limit explains itself and offers demo mode", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route("**/api/lifeline/claim", (route) => route.fulfill({ status: 429, json: { error: "rate" } }));
    await page.goto("/app?fault=rate", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", { name: "Open my practice account" });
    await expect(start).toHaveAttribute("data-ready", "yes");
    await start.click();
    await expect(page.locator(".ui-field-error")).toContainText("Too many new accounts from this network");
    await expect(page.getByRole("button", { name: "Use demo mode" })).toBeVisible();
    expectClean(await visibleText(page), "rate limit");
  });
});
