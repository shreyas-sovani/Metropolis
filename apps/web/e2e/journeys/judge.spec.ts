import { expect, test, type Page } from "@playwright/test";
import { SITE } from "../../lib/bounties";
import { forbiddenHit } from "../../lib/forbidden";

const live = process.env.E2E_WALLET === "test";

const radar = {
  chainId: 143,
  blockNumber: "111275464",
  calibrated: true,
  headline: { openInterestMicro: "3150000000000", atRiskNotionalMicro: "274500000000", atRiskCount: 141, idleMicro: "127400000000" },
  penalties: { paidUsd: "$12,400", avoidableUsd: "$4,100", atStakeUsd: "$800" },
  markets: [
    {
      perpId: 1,
      symbol: "BTC",
      markMicro: "83702300000",
      buckets: [
        { index: 40, side: "long", notionalMicro: "200000000", count: 2 },
        { index: 80, side: "short", notionalMicro: "100000000", count: 1 },
      ],
      atRisk: [],
    },
  ],
  positions: [],
  saves: { count: 4 },
};

async function mockTour(page: Page) {
  await page.route("**/api/radar**", (route) => route.fulfill({ json: radar }));
  await page.route("**/api/ops-health**", (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: Date.now() - 1000, lastBlock: 111275464, armed: 4, poolAvailable: 20, claimsToday: 1 },
    }),
  );
  await page.route("**/api/liquidations**", (route) => route.fulfill({ json: { latest: [], totals: { count: 3 } } }));
  await page.route("**/api/markets**", (route) => route.fulfill({ json: { markets: [{ perpId: 1, name: "Bitcoin", spark: [1, 2] }] } }));
  await page.route("**/api/saves**", (route) => route.fulfill({ json: { count: 4, watched: 4 } }));
  await page.route("**/api/twins**", (route) =>
    route.fulfill({
      json: {
        pairs: [
          {
            id: "btc-long",
            market: "BTC",
            side: "long",
            protected: { proxy: "0x36DF02ca0E9B1644e181342A795556a66eB28b10", mandate: "house", distanceE6: "51819", actions: [], outcome: "alive" },
            unprotected: { proxy: "0x0000000000000000000000000000000000000001", mandate: "none", distanceE6: "27000", actions: [], outcome: "alive" },
          },
        ],
      },
    }),
  );
  await page.route("**/api/lifeline/claim", (route) => route.fulfill({ status: 503, json: { error: "empty", sandbox: true } }));
  await page.route("**/api/lifeline/sandbox-accounts", (route) =>
    route.fulfill({ json: { accounts: [{ proxy: "0x1111111111111111111111111111111111111111", distanceE6: "27000" }] } }),
  );
  await page.route("**/api/lifeline/sandbox", (route) => {
    if (route.request().url().includes("sandbox-accounts")) return route.fallback();
    return route.fulfill({
      json: {
        txHash: `0x${"ab".repeat(32)}`,
        block: 20,
        addedCNS: "61000000",
        liqBefore: "81040000000",
        liqAfter: "78920000000",
        distBefore: "27000",
        distAfter: "60000",
      },
    });
  });
}

async function visible(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    root.querySelectorAll("code, pre, script, style").forEach((node) => node.remove());
    return root.innerText;
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/artifacts/v/journeys/${name}.png`, fullPage: true });
}

test.describe("judge tour", () => {
  test("J1 through J4, J7, J9, and J10", async ({ page }) => {
    test.setTimeout(180_000);
    const perpl: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("perpl.xyz")) perpl.push(request.url());
    });
    await mockTour(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Judging Metropolis? Take the 3-minute tour" })).toHaveAttribute("href", "/tour");
    await expect(page.locator(".site-header").getByRole("link", { name: "Judge tour" })).toHaveAttribute("href", "/tour");
    await page.goto("/tour", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "The 3-minute tour" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start the tour" })).toHaveAttribute("data-ready", "yes");
    await page.getByRole("button", { name: "Start the tour" }).click();
    await expect(page.getByText("Stop 1 of 5")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exit tour" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Stop 1 of 5")).toBeVisible();
    await expect(page.getByTestId("open-interest")).toBeVisible({ timeout: 15_000 });
    const before = await page.getByTestId("crash-line").innerText();
    await page.getByRole("slider", { name: "Shock BTC" }).fill("-3");
    await expect(page.getByTestId("crash-line")).not.toHaveText(before);
    await shot(page, "j4-radar-1440");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/replay/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/app/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/twins/, { timeout: 20_000 });
    await expect(page.getByTestId("twin-pair")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/tour\/evidence/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Perpl API" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Risk API" })).toHaveAttribute("href", /\/developers/);
    expect(forbiddenHit(await visible(page))).toBeNull();
    expect(perpl).toEqual([]);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/tour", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Start the tour" })).toBeVisible();
    await shot(page, "j9-tour-390");
  });

  test("J8 demo mode still produces a receipt", async ({ page }) => {
    test.setTimeout(60_000);
    await mockTour(page);
    await page.goto("/app?fault=pool", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", { name: "Open my practice account" });
    await expect(start).toHaveAttribute("data-ready", "yes");
    await start.click();
    await expect(page.getByTestId("sandbox")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Demo mode" })).toBeVisible();
    await page.getByRole("button", { name: "Sign and turn on protection" }).click();
    await expect(page.getByTestId("receipt")).toContainText("Distance", { timeout: 15_000 });
    expect(forbiddenHit(await visible(page))).toBeNull();
  });
});

test.describe("judge tour on production", () => {
  for (const run of [1, 2, 3]) {
    test(`landing tour and live radar (${run})`, async ({ page }) => {
      test.setTimeout(90_000);
      const perpl: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("perpl.xyz")) perpl.push(request.url());
      });
      await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: "Judging Metropolis? Take the 3-minute tour" })).toBeVisible();
      await page.goto(`${SITE}/tour`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Start the tour" })).toHaveAttribute("data-ready", "yes");
      const started = Date.now();
      await page.getByRole("button", { name: "Start the tour" }).click();
      await expect(page.getByTestId("open-interest")).toBeVisible({ timeout: 20_000 });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(perpl).toEqual([]);
    });
  }
});

test.describe("judge wallet stop", () => {
  test.skip(!live, "Set E2E_WALLET=test and run against the test-wallet server.");
  test.describe.configure({ mode: "serial" });

  for (const run of [1, 2, 3]) {
    test(`stop 3 receipt and stop 4 withdraw (${run})`, async ({ page }) => {
      test.setTimeout(180_000);
      const perpl: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("perpl.xyz")) perpl.push(request.url());
      });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const start = page.getByRole("button", { name: "Open my practice account" });
      await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
      const started = Date.now();
      await start.click();
      await page.getByRole("button", { name: "Take ownership" }).click({ timeout: 30_000 });
      await page.getByRole("button", { name: "Sign and turn on protection" }).click({ timeout: 45_000 });
      const receipt = page.getByTestId("receipt");
      await expect(receipt).toBeVisible({ timeout: 55_000 });
      expect(Date.now() - started).toBeLessThanOrEqual(60_000);
      await expect(receipt).toHaveAttribute("data-owner-txs", "1");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "What Lifeline can and can't do" })).toBeVisible();
      await page.getByRole("button", { name: "Withdraw idle AUSD" }).click();
      await page.getByLabel("Withdraw idle AUSD").fill("10");
      await page.getByRole("button", { name: "Withdraw", exact: true }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Withdrew 10 AUSD", { timeout: 45_000 });
      await page.goto("/twins", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("twin-pair").first()).toBeVisible({ timeout: 30_000 });
      expect(perpl).toEqual([]);
      await shot(page, `j6-twins-${run}`);
    });
  }
});
