import { expect, test, type Page } from "@playwright/test";
import { MAINNET_EXAMPLE, SITE } from "../../lib/bounties";
import { forbiddenHit } from "../../lib/forbidden";
import { formatPrice } from "../../lib/format";

const live = process.env.E2E_WALLET === "test";
const WORKER = process.env.NEXT_PUBLIC_WORKER_URL || "https://lifeline.lifeline-shreyas.workers.dev";
const H1 = "Don't get liquidated with money in your account.";
const NO_ACCOUNT = "This address has no Perpl account on mainnet.";

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
  dryRun: { action: "topUp", amountCNS: "61000000" },
};

async function mockPublic(page: Page, account: unknown) {
  await page.route("**/api/radar**", (route) =>
    route.fulfill({
      json: {
        chainId: 143,
        blockNumber: "111275464",
        calibrated: true,
        headline: { openInterestMicro: "3150000000000", atRiskNotionalMicro: "274500000000", atRiskCount: 141, idleMicro: "127400000000" },
        penalties: { paidUsd: "$12,400" },
        markets: [],
      },
    }),
  );
  await page.route("**/api/ops-health**", (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: Date.now() - 1000, lastBlock: 111275464, armed: 41, poolAvailable: 20 },
    }),
  );
  await page.route("**/api/liquidations**", (route) => route.fulfill({ json: { latest: [] } }));
  await page.route("**/api/saves**", (route) => route.fulfill({ json: { count: 0 } }));
  await page.route("**/api/account/**", (route) => route.fulfill({ json: account }));
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

test.describe("customer public pages", () => {
  test("C1 C2 C3 and C12", async ({ page }) => {
    test.setTimeout(120_000);
    const perpl: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("perpl.xyz")) perpl.push(request.url());
    });
    await mockPublic(page, { chainId: 143, found: true, accountId: "42", idleMicro: "300000000", positions: [position] });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
      await expect(page.getByTestId("landing-open-interest")).toContainText("$", { timeout: 20_000 });
      const protect = page.locator(".landing-hero").getByRole("link", { name: "Protect a position" });
      const check = page.getByRole("button", { name: "Check" });
      await expect(protect).toBeVisible();
      await expect(check).toBeVisible();
      const fold = width === 1440 ? 900 : 1600;
      for (const locator of [protect, check, page.getByTestId("live-strip")]) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(fold);
      }
      await shot(page, `c1-landing-${width}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/check", { waitUntil: "domcontentloaded" });
    await expect(page.locator("form")).toHaveAttribute("data-ready", "yes");
    await page.getByLabel("Address").fill(MAINNET_EXAMPLE);
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${MAINNET_EXAMPLE}\\?chain=143`), { timeout: 20_000 });
    const card = page.getByTestId("risk-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(formatPrice(position.liquidationMicro, position.priceDecimals));
    await expect(card).toContainText("%");
    await expect(card).toContainText("300 AUSD");
    await expect(card.getByTestId("dry-run")).toBeVisible();
    await expect(card.getByRole("link", { name: "Try it on a testnet practice account" })).toHaveAttribute("href", "/app");
    await shot(page, "c2-report-1440");
    expect(forbiddenHit(await visible(page))).toBeNull();

    await page.route("**/api/account/**", (route) => route.fulfill({ json: { found: false, accountId: "0", positions: [] } }));
    await page.goto("/a/0x0000000000000000000000000000000000000002?chain=143", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: NO_ACCOUNT })).toBeVisible();
    await expect(page.getByRole("link", { name: "A live mainnet account", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "A testnet practice account", exact: true })).toBeVisible();
    await shot(page, "c3-empty-1440");
    expect(perpl).toEqual([]);
    expect(forbiddenHit(await visible(page))).toBeNull();
  });
});

test.describe("customer public pages on production", () => {
  for (const run of [1, 2, 3]) {
    test(`live strip and a mainnet report (${run})`, async ({ page }) => {
      test.setTimeout(90_000);
      const perpl: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("perpl.xyz")) perpl.push(request.url());
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible();
      await expect(page.getByTestId("landing-open-interest")).toContainText("$", { timeout: 30_000 });
      await page.goto(`${SITE}/check`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("form")).toHaveAttribute("data-ready", "yes");
      await page.getByLabel("Address").fill(MAINNET_EXAMPLE);
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page).toHaveURL(new RegExp(`/a/${MAINNET_EXAMPLE}`), { timeout: 45_000 });
      await expect(page.getByTestId("risk-card").or(page.getByRole("heading", { name: NO_ACCOUNT }))).toBeVisible({ timeout: 30_000 });
      expect(forbiddenHit(await visible(page))).toBeNull();
      expect(perpl).toEqual([]);
    });
  }
});

async function act(page: Page, body: Record<string, string>): Promise<Record<string, string>> {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/e2e/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }, body);
}

test.describe("customer wallet journey", () => {
  test.skip(!live, "Set E2E_WALLET=test and run against the test-wallet server.");
  test.describe.configure({ mode: "serial" });

  for (const run of [1, 2, 3]) {
    test(`claim through pause (${run})`, async ({ page }) => {
      test.setTimeout(240_000);
      const perpl: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("perpl.xyz")) perpl.push(request.url());
      });
      await page.setViewportSize({ width: run === 1 ? 1440 : 390, height: 900 });
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const start = page.getByRole("button", { name: "Open my practice account" });
      await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
      const started = Date.now();
      await start.click();
      await expect(page.getByTestId("position-card")).toBeVisible({ timeout: 15_000 });
      const ownership = page.getByRole("button", { name: "Take ownership" });
      await expect(ownership).toBeVisible();
      await shot(page, `c4-practice-${run}`);
      await ownership.click();
      await expect(page.getByRole("link", { name: "Ownership transaction" })).toBeVisible({ timeout: 45_000 });
      const sign = page.getByRole("button", { name: "Sign and turn on protection" });
      await expect(sign).toBeVisible();
      await sign.click();
      const receipt = page.getByTestId("receipt");
      await expect(receipt).toBeVisible({ timeout: 55_000 });
      expect(Date.now() - started).toBeLessThanOrEqual(60_000);
      await expect(receipt).toHaveAttribute("data-owner-txs", "1");
      await expect(receipt).toContainText("Distance");
      await expect(receipt).toContainText("Liquidation price");
      await expect(receipt).toContainText("AUSD");
      await expect(receipt.getByRole("link", { name: "View the top-up" })).toBeVisible();
      const proxy = (await receipt.getAttribute("data-proxy")) ?? "";
      await shot(page, `c6-receipt-${run}`);

      await page.reload({ waitUntil: "domcontentloaded" });
      const dashboard = page.getByTestId("dashboard");
      await expect(dashboard).toBeVisible({ timeout: 30_000 });
      await expect(dashboard).toHaveAttribute("data-account", proxy);
      await expect(page.getByRole("link", { name: "View" }).first()).toBeVisible();

      await expect(page.getByText("Lifeline's key can't do this")).toBeVisible();
      await expect(page.getByRole("link", { name: "this account on the explorer" })).toBeVisible();
      const before = BigInt((await act(page, { op: "balance" })).balance ?? "0");
      await page.getByRole("button", { name: "Withdraw idle AUSD" }).click();
      await page.getByLabel("Withdraw idle AUSD").fill("25");
      await page.getByRole("button", { name: "Withdraw", exact: true }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Withdrew 25 AUSD", { timeout: 45_000 });
      const after = BigInt((await act(page, { op: "balance" })).balance ?? "0");
      expect(after - before).toBe(25_000_000n);

      await page.getByRole("button", { name: "Pause protection" }).click();
      await expect.poll(async () => (await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`)).status, { timeout: 20_000 }).toBe(404);
      await expect(page.getByText("Paused. Lifeline won't add margin until you resume.")).toBeVisible();
      await page.getByRole("button", { name: "Resume protection" }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Protection is on again", { timeout: 30_000 });

      await page.getByRole("button", { name: "Save with email" }).click();
      await expect(page.getByText("Saved to your email")).toBeVisible();
      await expect(dashboard).toHaveAttribute("data-account", proxy);
      expect(forbiddenHit(await visible(page))).toBeNull();
      expect(perpl).toEqual([]);
      await shot(page, `c8-dashboard-${run}`);
    });
  }
});
