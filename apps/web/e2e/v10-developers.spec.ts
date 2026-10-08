import { expect, test } from "@playwright/test";
import { RISK_EXAMPLE } from "../lib/api-docs";

const account = {
  chainId: 143,
  address: RISK_EXAMPLE,
  accountId: "1",
  found: true,
  idleMicro: "1000000",
  positions: [
    {
      symbol: "BTC",
      side: "short",
      liquidationPricePNS: "889478",
      distanceE6: "21000",
    },
  ],
};

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("run, copy, and the rate-limit message", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 111, armed: 4, poolAvailable: 12 },
    }),
  );
  await page.route(/\/api\/v1\/risk\//, (route) => route.fulfill({ json: account }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Developers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveAttribute("data-ready", "yes");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.locator("#status")).toBeVisible();

  const curl = page.getByTestId("curl");
  await expect(curl).toContainText(`/api/v1/risk/${RISK_EXAMPLE}?chain=143`);
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe((await curl.innerText()).trim());

  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByTestId("risk-json")).toContainText('"liquidationPricePNS": "889478"');
  await expect(page.getByTestId("risk-status")).toContainText("200");

  await page.addStyleTag({ content: ".site-header{position:static !important} nextjs-portal{display:none !important}" });
  await page.screenshot({ path: "e2e/artifacts/v10-developers-1440.png", fullPage: true });
});

test("a 429 from the limiter shows in the panel", async ({ page }) => {
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({ json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 1, armed: 1, poolAvailable: 1 } }),
  );
  await page.route(/\/api\/v1\/risk\//, (route) => route.fulfill({ status: 429, json: { error: "rate" } }));
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  const run = page.getByRole("button", { name: "Run" });
  await expect(run).toHaveAttribute("data-ready", "yes");
  await run.click();
  await expect(page.getByTestId("risk-status")).toContainText("429");
  await expect(page.getByTestId("risk-message")).toHaveText(
    "Too many calls from this network. The limit is 60 a minute. Wait a minute and run it again.",
  );
});

test("the live example matches the account route", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  const run = page.getByRole("button", { name: "Run" });
  await expect(run).toHaveAttribute("data-ready", "yes");
  await run.click();
  await expect(page.getByTestId("risk-status")).toContainText("200", { timeout: 60_000 });
  const shown = JSON.parse(await page.getByTestId("risk-json").innerText()) as {
    positions?: { liquidationPricePNS?: string }[];
  };
  const accountResponse = await page.request.get(`/api/account/${RISK_EXAMPLE}?chain=143`);
  expect(accountResponse.status()).toBe(200);
  const body = (await accountResponse.json()) as { positions?: { liquidationPricePNS?: string }[] };
  expect(shown.positions?.[0]?.liquidationPricePNS).toBeTruthy();
  expect(shown.positions?.[0]?.liquidationPricePNS).toBe(body.positions?.[0]?.liquidationPricePNS);
});
