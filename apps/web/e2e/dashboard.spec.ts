import { expect, test, type Page } from "@playwright/test";

const live = process.env.E2E_WALLET === "test";
const WORKER = process.env.NEXT_PUBLIC_WORKER_URL || "https://lifeline.lifeline-shreyas.workers.dev";

async function act(page: Page, body: Record<string, string>): Promise<Record<string, unknown>> {
  return page.evaluate(async (payload) => {
    const response = await fetch("/api/e2e/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }, body);
}

test.describe("dashboard on testnet", () => {
  test.skip(!live, "Set E2E_WALLET=test and run against the test-wallet server.");

  test("reload, adjust, pause, resume, withdraw, and a keeper top-up", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", { name: "Open my practice account" });
    await expect(start).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
    await start.click();
    await page.getByRole("button", { name: "Take ownership" }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: "Sign and turn on protection" }).click({ timeout: 45_000 });
    const receipt = page.getByTestId("receipt");
    await expect(receipt).toBeVisible({ timeout: 55_000 });
    const proxy = (await receipt.getAttribute("data-proxy")) ?? "";
    const beforeTarget = Number((await receipt.getAttribute("data-target")) ?? "0");

    await page.reload({ waitUntil: "domcontentloaded" });
    const dashboard = page.getByTestId("dashboard");
    await expect(dashboard).toBeVisible({ timeout: 30_000 });
    await expect(dashboard).toHaveAttribute("data-account", proxy);
    await expect(page.getByRole("heading", { name: "Your protection" })).toBeVisible();
    await expect(page.getByText(/Safety line/)).toBeVisible();
    await expect(page.getByRole("link", { name: "View" }).first()).toHaveAttribute("href", /\/tx\/0x/);

    const beat = page.getByTestId("heartbeat");
    const firstBeat = await beat.innerText();
    await expect(beat).not.toHaveText(firstBeat, { timeout: 12_000 });

    await page.getByRole("button", { name: "Adjust safety line" }).click();
    const slider = page.getByLabel("Keep my position at least this far from liquidation");
    const higher = Math.min(20, Math.max(beforeTarget / 100 + 2, 12));
    await slider.fill(String(higher));
    await page.getByRole("button", { name: "Save safety line" }).click();
    await expect(page.getByTestId("flow-note")).toContainText("Safety line updated", { timeout: 30_000 });
    const mandate = await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`);
    const saved = (await mandate.json()) as { typedData?: { targetBps?: number }; active?: boolean };
    expect(mandate.status).toBe(200);
    expect(saved.typedData?.targetBps ?? 0).toBeGreaterThan(beforeTarget);

    await page.getByRole("button", { name: "Pause protection" }).click();
    await expect.poll(async () => (await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`)).status, { timeout: 20_000 }).toBe(404);
    await expect(page.getByRole("button", { name: "Resume protection" })).toBeVisible();

    await page.getByRole("button", { name: "Resume protection" }).click();
    await expect(page.getByTestId("flow-note")).toContainText("Protection is on again", { timeout: 30_000 });
    const resumed = await fetch(`${WORKER.replace(/\/$/, "")}/mandate/${proxy}`);
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { active?: boolean }).active).toBe(true);

    const before = BigInt(String((await act(page, { op: "balance" })).balance ?? "0"));
    await page.getByRole("button", { name: "Withdraw idle AUSD" }).click();
    await page.getByLabel("Withdraw idle AUSD").fill("25");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByTestId("flow-note")).toContainText("Withdrew 25 AUSD", { timeout: 45_000 });
    const after = BigInt(String((await act(page, { op: "balance" })).balance ?? "0"));
    expect(after - before).toBe(25_000_000n);

    const linksBefore = await page.getByRole("link", { name: "View" }).count();
    const breached = await act(page, { op: "breach", proxy });
    expect(String(breached.armed)).toBe("true");
    await expect.poll(async () => page.getByRole("link", { name: "View" }).count(), { timeout: 15_000 }).toBeGreaterThan(linksBefore);
  });
});
