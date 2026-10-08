import { expect, test, type Page } from "@playwright/test";

const live = process.env.E2E_WALLET === "test";
const WORKER = process.env.NEXT_PUBLIC_WORKER_URL || "https://lifeline.lifeline-shreyas.workers.dev";

const forbidden = [
  /\bCNS\b/,
  /\bPNS\b/,
  /\bLNS\b/,
  /\bbps\b/i,
  /\w+E6\b/,
  /\bnonce\b/i,
  /\bselector\b/i,
  /\bcalldata\b/i,
  /\bproxy\b/i,
  /DelegatedAccount/,
  /acceptOwnership/,
  /increasePositionCollateral/,
  /execOrder/,
  /pendingOwner/,
  /\boperator\b/i,
  /\bsandbox\b/i,
  /\bkeeper\b/i,
  /Durable Object/,
  /perp\s*\d/i,
  /\b(?:ABOVE_TRIGGER|BELOW_MIN|MARK_INVALID|PAUSED|EXPIRED)\b/,
  /ms from/i,
  /Wallet transactions before/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\bnull\b/,
  /\bdisarm\b/i,
];

function inBand(distAfterE6: bigint, targetBps: number): boolean {
  const target = (BigInt(targetBps) * 1_000_000n) / 10_000n;
  return distAfterE6 >= target - 2_000n && distAfterE6 <= target + 5_000n;
}

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

async function expectClean(page: Page) {
  const text = await page.locator("main").innerText();
  for (const pattern of forbidden) expect(text).not.toMatch(pattern);
}

test.describe("try lifeline on testnet", () => {
  test.skip(!live, "Set E2E_WALLET=test and run against the test-wallet server.");
  test.describe.configure({ mode: "serial" });

  for (const run of [1, 2, 3]) {
    test(`claim, accept, arm, withdraw, pause (${run})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      const start = page.getByRole("button", { name: "Open my practice account" });
      await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
      const started = Date.now();
      await start.click();
      const ownership = page.getByRole("button", { name: "Take ownership" });
      await expect(ownership).toBeVisible({ timeout: 30_000 });
      await expectClean(page);
      await ownership.click();
      const sign = page.getByRole("button", { name: "Sign and turn on protection" });
      await expect(sign).toBeVisible({ timeout: 45_000 });
      await expectClean(page);
      await sign.click();
      const receipt = page.getByTestId("receipt");
      await expect(receipt).toBeVisible({ timeout: 55_000 });
      expect(Date.now() - started).toBeLessThanOrEqual(60_000);
      await expect(receipt).toHaveAttribute("data-owner-txs", "1");
      await expect(receipt).toHaveAttribute("data-elapsed-ms", /\d+/);
      await expectClean(page);
      const proxy = (await receipt.getAttribute("data-proxy")) ?? "";
      const perpId = (await receipt.getAttribute("data-perp")) ?? "";
      const target = Number((await receipt.getAttribute("data-target")) ?? "0");
      const chain = await act(page, { op: "distance", proxy, perpId });
      expect(inBand(BigInt(chain.distanceE6 ?? "0"), target)).toBe(true);
      const before = BigInt((await act(page, { op: "balance" })).balance ?? "0");
      await page.getByRole("button", { name: "Withdraw 50 AUSD" }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Withdrew 50 AUSD", { timeout: 45_000 });
      const after = BigInt((await act(page, { op: "balance" })).balance ?? "0");
      expect(after - before).toBe(50_000_000n);
      await page.getByRole("button", { name: "Pause protection" }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Paused", { timeout: 20_000 });
      await expectClean(page);
      const mandate = await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`);
      expect(mandate.status).toBe(404);
    });
  }

  test("a reload resumes the same practice account", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", { name: "Open my practice account" });
    await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
    await start.click();
    await expect(page.getByRole("button", { name: "Take ownership" })).toBeVisible({ timeout: 30_000 });
    const account = (await page.locator(".protect-checks").getAttribute("data-account")) ?? "";
    expect(account).toMatch(/^0x[0-9a-fA-F]{40}$/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Take ownership" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-account]")).toHaveAttribute("data-account", account);
    await expect(page.getByText("already claimed")).toHaveCount(0);
    await page.getByRole("button", { name: "Take ownership" }).click();
    await expect(page.getByRole("button", { name: "Sign and turn on protection" })).toBeVisible({ timeout: 45_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Sign and turn on protection" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-account]")).toHaveAttribute("data-account", account);
    await expect(page.getByText("already claimed")).toHaveCount(0);
  });
});
