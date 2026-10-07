import { expect, test, type Page } from "@playwright/test";
import { MAINNET_EXAMPLE, PRACTICE_ACCOUNT } from "../lib/bounties";
import { formatPrice } from "../lib/format";

const MAINNET_ACTION = "Try it on a testnet practice account";
const NO_ACCOUNT = "This address has no Perpl account on mainnet.";
const NO_POSITIONS = "This account has no open positions.";

const position = {
  perpId: 16,
  symbol: "BTC",
  side: "long",
  entryMicro: "80000000000",
  markMicro: "83702300000",
  liquidationPricePNS: "837023",
  liquidationMicro: "83702300000",
  priceDecimals: 1,
  distanceE6: "32000",
  depositMicro: "200000000",
  freeCNS: "300000000",
  forfeitCNS: "160000000",
  notionalMicro: "3000000000",
  dryRun: { action: "topUp", amountCNS: "61000000" },
};

const account = {
  chainId: 143,
  address: MAINNET_EXAMPLE,
  accountId: "42",
  found: true,
  idleMicro: "300000000",
  positions: [position],
};

async function mockApis(page: Page, payload: unknown) {
  await page.route(/\/api\/account\//, (route) => route.fulfill({ json: payload }));
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111, armed: 4, poolAvailable: 12 },
    }),
  );
  await page.route(/\/api\/lifeline\/me/, (route) => route.fulfill({ json: { claim: null } }));
}

test("check rejects a bad address and opens a valid one", async ({ page }) => {
  test.setTimeout(90_000);
  await mockApis(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/check", { waitUntil: "domcontentloaded" });
  await expect(page.locator("form")).toHaveAttribute("data-ready", "yes");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check an address");
  await expect(page.getByText("Nothing is signed or sent.")).toBeVisible();
  await expect(page.getByLabel("Chain")).toHaveValue("143");
  await expect(page.getByRole("link", { name: "A live mainnet account" })).toHaveAttribute("href", `/a/${MAINNET_EXAMPLE}?chain=143`);
  await expect(page.getByRole("link", { name: "A testnet practice account" })).toHaveAttribute("href", `/a/${PRACTICE_ACCOUNT}?chain=10143`);

  await page.getByLabel("Address").fill("not-an-address");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That isn't a valid address.")).toBeVisible();
  await expect(page).toHaveURL(/\/check$/);

  await page.getByLabel("Chain").selectOption("10143");
  await page.getByLabel("Address").fill(MAINNET_EXAMPLE);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${MAINNET_EXAMPLE}\\?chain=10143$`), { timeout: 45_000 });
});

test("check screenshot", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApis(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/check", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check an address");
  await expect(page.getByRole("button", { name: "All systems normal" })).toBeVisible();
  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: "e2e/artifacts/v6-check-1440.png", fullPage: true });
});

test("mainnet report matches the account and opens the practice account", async ({ page }) => {
  test.setTimeout(90_000);
  const perpl: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("perpl.xyz")) perpl.push(request.url());
  });
  await mockApis(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/a/${MAINNET_EXAMPLE}?chain=143`, { waitUntil: "domcontentloaded" });
  const risk = page.getByTestId("risk-card");
  await expect(risk).toBeVisible({ timeout: 30_000 });
  await expect(risk).toHaveAttribute("data-liq", position.liquidationPricePNS);
  await expect(risk).toContainText(formatPrice(position.liquidationMicro, position.priceDecimals));
  await expect(risk).toContainText("300 AUSD");
  await expect(risk).toContainText("$160");
  await expect(risk.getByTestId("dry-run")).toContainText("Protection on mainnet: coming via API-key mode.");
  await expect(page.getByText("Mainnet · read-only")).toBeVisible();
  await expect(page.getByTestId("idle-ausd")).toHaveText("300");
  await expect(risk.getByRole("link", { name: MAINNET_ACTION })).toHaveAttribute("href", "/app");

  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: "e2e/artifacts/v6-report-mainnet-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: "e2e/artifacts/v6-report-mainnet-390.png", fullPage: true });

  const clayText = await page.evaluate(() => {
    const clay = "rgb(217, 119, 87)";
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      const parent = walker.currentNode.parentElement;
      if (!text || !parent) continue;
      if (getComputedStyle(parent).color === clay) found.push(text.slice(0, 48));
    }
    return found;
  });
  expect(clayText).toEqual([]);
  expect(perpl).toEqual([]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await risk.getByRole("link", { name: MAINNET_ACTION }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 45_000 });
});

test("an address with no account offers both examples", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApis(page, { found: false, accountId: "0", idleMicro: "0", positions: [] });
  await page.goto("/a/0x0000000000000000000000000000000000000002?chain=143", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: NO_ACCOUNT })).toBeVisible();
  await expect(page.getByRole("link", { name: "A live mainnet account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "A testnet practice account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: MAINNET_ACTION })).toHaveAttribute("href", "/app");
  await expect(page.getByText(NO_POSITIONS)).toHaveCount(0);
});
