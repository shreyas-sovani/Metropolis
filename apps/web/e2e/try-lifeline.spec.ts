import { expect, test, type Page } from "@playwright/test";

const live = process.env.E2E_WALLET === "test";
const WORKER = process.env.NEXT_PUBLIC_WORKER_URL || "https://lifeline.lifeline-shreyas.workers.dev";

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

test.describe("try lifeline on testnet", () => {
  test.skip(!live, "Set E2E_WALLET=test and run against the test-wallet server.");
  test.describe.configure({ mode: "serial" });

  for (const run of [1, 2, 3]) {
    test(`claim, accept, arm, withdraw, disarm (${run})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/lifeline", { waitUntil: "domcontentloaded" });
      const start = page.getByRole("button", { name: "Try Lifeline live" });
      await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
      const started = Date.now();
      await start.click();
      await expect(page.getByRole("button", { name: "Accept ownership" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Accept ownership" }).click();
      await expect(page.getByRole("button", { name: "Arm Lifeline" })).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("owner-txs")).toHaveText("Wallet transactions before the receipt: 1");
      await page.getByRole("button", { name: "Arm Lifeline" }).click();
      const receipt = page.getByTestId("receipt");
      await expect(receipt).toBeVisible({ timeout: 55_000 });
      expect(Date.now() - started).toBeLessThanOrEqual(60_000);
      await expect(receipt.getByTestId("owner-txs")).toHaveText("Wallet transactions before the receipt: 1");
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
      await page.getByRole("button", { name: "Disarm" }).click();
      await expect(page.getByTestId("flow-note")).toContainText("Disarmed", { timeout: 20_000 });
      const mandate = await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`);
      expect(mandate.status).toBe(404);
    });
  }
});
