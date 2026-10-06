import { expect, test } from "@playwright/test";

const house = {
  pairs: [
    {
      id: "btc-long",
      market: "BTC",
      side: "long",
      protected: {
        proxy: "0x36DF02ca0E9B1644e181342A795556a66eB28b10",
        mandate: "house",
        distanceE6: "27000",
        actions: [],
        outcome: "alive",
      },
      unprotected: {
        proxy: "0x0000000000000000000000000000000000000001",
        mandate: "none",
        distanceE6: "27000",
        actions: [{ txHash: "0x96442cfb", block: 4, amountCNS: "1000000" }],
        outcome: "alive",
      },
    },
  ],
};

const armed = {
  txHash: "0x85fe2562",
  block: 20,
  addedCNS: "1000000",
  liqBefore: "64000000000",
  liqAfter: "61000000000",
  distBefore: "27000",
  distAfter: "60000",
  msFromRequest: 80,
};

test("a blocked Privy call falls through to a sandbox arm", async ({ page }) => {
  test.setTimeout(40_000);
  await page.route("**/api/twins", (route) => route.fulfill({ json: house }));
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.route("**/api/lifeline/sandbox", (route) => route.fulfill({ json: armed }));
  await page.goto("/lifeline", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Try Lifeline live" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await page.route(/https:\/\/[^/]*privy\.io\//, (route) => route.abort());
  await start.click();
  await expect(page.getByTestId("sandbox")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Arm in sandbox" }).click();
  await expect(page.getByTestId("receipt")).toContainText("Distance 2.7% → 6.0%");
});

test("an empty pool opens sandbox", async ({ page }) => {
  await page.route("**/api/lifeline/claim", (route) => route.fulfill({ status: 503, json: { error: "empty", sandbox: true } }));
  await page.route("**/api/twins", (route) => route.fulfill({ json: house }));
  await page.route("**/api/lifeline/sandbox", (route) => route.fulfill({ json: armed }));
  await page.goto("/lifeline?fault=pool", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Try Lifeline live" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await start.click();
  await expect(page.getByTestId("sandbox")).toBeVisible();
  await page.getByRole("button", { name: "Arm in sandbox" }).click();
  await expect(page.getByTestId("receipt")).toBeVisible();
});

test("a degraded health check shows the banner", async ({ page }) => {
  await page.route("**/api/ops-health", (route) => route.fulfill({ json: { degraded: true, paused: false, rpc: false } }));
  await page.route("**/api/radar**", (route) => route.fulfill({
    json: {
      chainId: 143,
      blockNumber: "1",
      headline: { openInterestMicro: "0", atRiskNotionalMicro: "0", atRiskCount: 0, idleMicro: "0" },
      markets: [],
      positions: [],
    },
  }));
  await page.route("**/api/liquidations", (route) => route.fulfill({ json: { latest: [] } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [] } }));
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Lifeline degraded")).toBeVisible();
  await expect(page.getByText("No open positions on this chain yet.")).toBeVisible();
});

test("radar still loads when the primary RPC is dead", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?rpc=dead", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-interest")).toBeVisible({ timeout: 60_000 });
});

test("twins render every pair and link each action", async ({ page }) => {
  await page.route("**/api/twins", (route) => route.fulfill({ json: house }));
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/twins", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("twin-pair")).toHaveCount(1);
  const action = page.getByTestId("twin-action");
  await expect(action).toHaveAttribute("href", "https://testnet.monadexplorer.com/tx/0x96442cfb");
  await expect(action).toHaveAttribute("data-amount", "1000000");
  await expect(page.getByTestId("outcome").first()).toHaveText("Alive");
});
