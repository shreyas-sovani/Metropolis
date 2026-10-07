import { expect, test } from "@playwright/test";

const snapshot = {
  chainId: 143,
  blockNumber: "110",
  calibrated: true,
  headline: {
    openInterestMicro: "1500000000",
    atRiskNotionalMicro: "400000000",
    atRiskCount: 2,
    idleMicro: "25000000",
  },
  penalties: { paidUsd: "$12", avoidableUsd: "$4", atStakeUsd: "$3" },
  markets: [
    {
      perpId: 1,
      symbol: "BTC",
      markMicro: "100000000000",
      buckets: [
        { index: 40, side: "long", notionalMicro: "200000000", count: 2 },
        { index: 80, side: "short", notionalMicro: "100000000", count: 1 },
      ],
      atRisk: [{ id: "ab12cd34", side: "long", distanceE6: "25000", notionalMicro: "200000000", freeMicro: "10000000", depositMicro: "5000000", bucketIndex: 40, couldProtectNow: true }],
    },
    {
      perpId: 2,
      symbol: "ETH",
      markMicro: "4000000000",
      buckets: [{ index: 50, side: "long", notionalMicro: "50000000", count: 1 }],
      atRisk: [],
    },
    {
      perpId: 3,
      symbol: "SOL",
      markMicro: "150000000000",
      buckets: [],
      atRisk: [],
    },
  ],
};

test("radar matches the payload", async ({ page }) => {
  test.setTimeout(120_000);
  const perpl: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("perpl.xyz")) perpl.push(request.url());
  });
  await page.route(/\/api\/radar/, async (route) => {
    const chain = new URL(route.request().url()).searchParams.get("chain");
    await route.fulfill({ json: { ...snapshot, chainId: chain === "10143" ? 10143 : 143 } });
  });
  await page.route(/\/api\/liquidations/, (route) => route.fulfill({ json: { latest: [{ blockNumber: 9, perpId: "1", notionalMicro: "1000000" }], rows: [], totals: { count: 0, notionalMicro: "0", idleAtLiq: "0" }, stale: false } }));
  await page.route(/\/api\/markets/, (route) => route.fulfill({ json: { markets: [{ perpId: 1, name: "Bitcoin", spark: [1, 2, 3] }], source: "perpl" } }));
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0, saves: [] } }));
  await page.route(/\/api\/ops-health/, (route) => route.fulfill({ json: { degraded: false, paused: false, rpc: false } }));
  await page.route(/\/api\/lifeline\/me/, (route) => route.fulfill({ status: 401, json: {} }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-interest")).toHaveText("$1,500", { timeout: 30_000 });
  await expect(page.getByTestId("at-risk-count")).toHaveText("2 · $400");
  await expect(page.getByTestId("idle")).toHaveText("$25");
  await expect(page.getByTestId("block")).toHaveText("110");
  await expect(page.getByTestId("penalties")).toContainText(
    "Of $12 in penalties over 30 days, $4 belonged to accounts whose idle AUSD could have moved the liquidation price at least 1% away.",
  );
  await expect(page.getByTestId("at-stake")).toContainText("Penalty at stake now: $3");
  await expect(page.getByTestId("saves")).toHaveText("Saves 0");
  await expect(page.getByTestId("crash-label").first()).toHaveText("first-order: excludes cascade price impact");
  await expect(page.getByRole("heading", { name: /Bitcoin/ })).toBeVisible();
  await expect(page.getByTestId("spark")).toBeVisible();
  await expect(page.getByText("No positions near liquidation in SOL.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SOL" })).toHaveCount(0);
  await page.getByRole("button", { name: "ETH", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ETH" })).toBeVisible();
  await page.getByRole("button", { name: "Bitcoin", exact: true }).click();
  await expect(page.getByRole("link", { name: "Contract-exact" })).toBeVisible();
  await page.getByTestId("bucket").first().hover();
  await expect(page.getByTestId("bucket-detail")).toContainText("longs");
  await page.getByRole("button", { name: /ab12cd34/ }).click();
  await expect(page.getByTestId("risk-detail")).toContainText("ab12cd34");
  await page.keyboard.press("Escape");
  const map = await page.locator("[data-map]").innerText();
  expect(map).not.toMatch(/0x[a-fA-F]{40}/);
  await page.addStyleTag({ content: ".site-header{position:static !important}" });
  await page.screenshot({ path: "e2e/artifacts/v5-radar-1440.png", fullPage: true });
  await page.screenshot({ path: "e2e/artifacts/radar-1440.png", fullPage: true });
  await page.getByRole("slider", { name: "Shock BTC" }).fill("-3");
  await expect(page.locator(".radar-shock")).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/v5-radar-crash-1440.png", fullPage: true });

  const testnet = page.waitForRequest((request) => request.url().includes("/api/radar") && request.url().includes("chain=10143"));
  await page.getByRole("button", { name: "Testnet" }).click();
  await testnet;
  await expect(page.getByTestId("block")).toHaveText("110");

  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: "e2e/artifacts/v5-radar-390.png", fullPage: true });
  await page.screenshot({ path: "e2e/artifacts/radar-390.png", fullPage: true });
  expect(perpl).toEqual([]);
});

test("radar still renders when the Perpl API is blocked", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/\/api\/radar/, (route) => route.fulfill({ json: snapshot }));
  await page.route(/\/api\/liquidations/, (route) => route.fulfill({ json: { latest: [] } }));
  await page.route(/\/api\/markets/, (route) => route.fulfill({ status: 200, json: { markets: [], source: "onchain" } }));
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0, saves: [] } }));
  await page.route(/\/api\/ops-health/, (route) => route.fulfill({ json: { degraded: false, paused: false, rpc: false } }));
  await page.route(/\/api\/lifeline\/me/, (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "BTC" })).toBeVisible();
  await page.getByRole("button", { name: "ETH", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ETH" })).toBeVisible();
  await expect(page.getByTestId("open-interest")).toHaveText("$1,500");
});

test("a signed-in testnet session marks your position", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route(/\/api\/radar/, async (route) => {
    const url = new URL(route.request().url());
    const highlight = url.searchParams.get("highlight");
    await route.fulfill({
      json: {
        ...snapshot,
        chainId: 10143,
        ...(highlight ? { highlightId: "ab12cd34" } : {}),
      },
    });
  });
  await page.route(/\/api\/liquidations/, (route) => route.fulfill({ json: { latest: [] } }));
  await page.route(/\/api\/markets/, (route) => route.fulfill({ json: { markets: [], source: "onchain" } }));
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0, saves: [] } }));
  await page.route(/\/api\/ops-health/, (route) => route.fulfill({ json: { degraded: false, paused: false, rpc: false } }));
  await page.route(/\/api\/lifeline\/me/, (route) =>
    route.fulfill({ json: { claim: { proxy: "0x1111111111111111111111111111111111111111" } } }),
  );
  await page.goto("/radar?chain=10143", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Your position")).toBeVisible();
  await expect(page.locator('[data-testid="bucket"][data-yours="true"]')).toHaveCount(1);
  const map = await page.locator("[data-map]").innerText();
  expect(map).not.toMatch(/0x[a-fA-F]{40}/);
  expect(map).not.toContain("1111111111111111111111111111111111111111");
});
