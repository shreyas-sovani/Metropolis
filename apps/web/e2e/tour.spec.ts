import { expect, test, type Page } from "@playwright/test";

const radar = {
  chainId: 143,
  blockNumber: "110",
  calibrated: true,
  headline: {
    openInterestMicro: "1500000000",
    positionCount: 608,
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
      buckets: [{ index: 40, side: "long", notionalMicro: "200000000", count: 2 }],
      atRisk: [],
    },
  ],
};

async function quiet(page: Page) {
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: {
        status: "normal",
        degraded: false,
        paused: false,
        rpc: false,
        lastAlarmAt: 1,
        lastBlock: 111,
        armed: 4,
        poolAvailable: 12,
        claimsToday: 1,
      },
    }),
  );
  await page.route(/\/api\/radar/, (route) => route.fulfill({ json: radar }));
  await page.route(/\/api\/liquidations/, (route) =>
    route.fulfill({
      json: { latest: [], rows: [], totals: { count: 577, notionalMicro: "0", idleAtLiq: "0" }, eligible: { count: 1, notionalMicro: "0" }, stale: false },
    }),
  );
  await page.route(/\/api\/markets/, (route) => route.fulfill({ json: { markets: [], source: "perpl" } }));
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0, watched: 4, saves: [] } }));
  await page.route("**/api/twins", (route) =>
    route.fulfill({
      json: {
        pairs: [
          {
            id: "btc-long",
            market: "BTC",
            side: "long",
            protected: { proxy: "0x36DF02ca0E9B1644e181342A795556a66eB28b10", mandate: "house", distanceE6: "51819", actions: [], outcome: "alive" },
            unprotected: { proxy: "0x0000000000000000000000000000000000000001", mandate: "none", distanceE6: "0", actions: [], outcome: "liquidated at block 4" },
          },
        ],
      },
    }),
  );
}

async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: `e2e/artifacts/${name}`, fullPage: true });
}

test("the judge walks all five stops", async ({ page }) => {
  test.setTimeout(180_000);
  const perpl: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("perpl.xyz")) perpl.push(request.url());
  });
  await quiet(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tour", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "The 3-minute tour" })).toBeVisible();
  await expect(page.getByText("Five stops. Every number is live and every transaction is real.")).toBeVisible();
  await page.getByRole("link", { name: "Go straight to the evidence" }).click();
  await expect(page).toHaveURL(/\/tour\/evidence/);
  await expect(page.getByRole("region", { name: "Judge tour" })).toHaveCount(0);

  await page.goto("/tour", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Start the tour" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await start.click();
  await expect(page).toHaveURL(/\/radar/, { timeout: 20_000 });
  const rail = page.getByRole("region", { name: "Judge tour" });
  await expect(rail).toContainText("Stop 1 of 5");
  await expect(rail).toContainText("Live market risk");
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "1");
  await expect(page.getByText("Drag the BTC slider to −3%.")).toBeVisible();
  await shot(page, "v11-stop1-390.png");

  await rail.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/replay/, { timeout: 45_000 });
  await expect(rail).toContainText("Stop 2 of 5");
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "2");
  await shot(page, "v11-stop2-390.png");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Judge tour" })).toContainText("Stop 2 of 5");
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "2");

  await page.getByRole("region", { name: "Judge tour" }).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Protect a position" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "3");
  await expect(page.getByText("Open it, take ownership, sign your safety line.")).toBeVisible();
  await shot(page, "v11-stop3-390.png");

  await page.getByRole("region", { name: "Judge tour" }).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/twins/, { timeout: 45_000 });
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "4");
  await expect(page.getByText("Withdraw some AUSD; only you can. Then open the twins.")).toBeVisible();
  await shot(page, "v11-stop4-390.png");

  await page.getByRole("region", { name: "Judge tour" }).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/tour\/evidence/, { timeout: 45_000 });
  await expect(page.getByTestId("tour-stop")).toHaveAttribute("data-stop", "5");
  await expect(page.getByTestId("key-numbers")).toContainText("608");
  await expect(page.getByTestId("key-numbers")).toContainText("577");
  await expect(page.getByTestId("key-numbers")).toContainText("100%");
  await expect(page.getByTestId("key-numbers")).toContainText("4");
  await expect(page.getByTestId("key-numbers")).toContainText("1");
  await shot(page, "v11-stop5-390.png");

  await page.getByRole("button", { name: "Exit tour" }).click();
  await expect(page.getByRole("region", { name: "Judge tour" })).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("lifeline.tour"));
  expect(stored).toContain('"active":false');
  expect(perpl).toEqual([]);
});
