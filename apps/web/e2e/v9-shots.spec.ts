import { expect, test, type Page } from "@playwright/test";

const twins = {
  pairs: [
    {
      id: "btc-long",
      market: "BTC",
      side: "long",
      protected: {
        proxy: "0x36DF02ca0E9B1644e181342A795556a66eB28b10",
        mandate: "house",
        distanceE6: "51819",
        actions: [],
        outcome: "alive",
      },
      unprotected: {
        proxy: "0x0000000000000000000000000000000000000001",
        mandate: "none",
        distanceE6: "0",
        actions: [{ txHash: "0x96442cfb", block: 4, amountCNS: "1000000" }],
        outcome: "liquidated at block 4",
      },
    },
  ],
};

async function quiet(page: Page) {
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111, armed: 4, poolAvailable: 12 },
    }),
  );
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.route("**/api/twins", (route) => route.fulfill({ json: twins }));
}

const pages = [
  ["proof", "/proof", "Proof"],
  ["twins", "/twins", "Twins"],
  ["replay", "/replay", "A real liquidation"],
  ["methodology", "/methodology", "Contract-exact"],
] as const;

for (const width of [390, 1440]) {
  test(`proof pages at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await quiet(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, path, heading] of pages) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
      await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
      await page.screenshot({ path: `e2e/artifacts/v9-${name}-${width}.png`, fullPage: true });
    }
  });
}

test("proof links stay on this site or a block explorer", async ({ page }) => {
  await quiet(page);
  for (const path of ["/proof", "/twins", "/replay", "/methodology"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const hrefs = await page.locator("main a[href]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const url = new URL(href);
      const local = url.origin === new URL(page.url()).origin;
      const explorer = url.hostname === "testnet.monadexplorer.com" || url.hostname === "monadscan.com";
      expect(local || explorer, href).toBe(true);
      if (local) {
        const response = await page.request.get(href);
        expect(response.status(), href).toBeLessThan(400);
      }
    }
  }
});
