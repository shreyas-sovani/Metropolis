import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = path.resolve(__dirname, "../../..");

function cli(args: string[]): string {
  return execFileSync("pnpm", ["cli", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
}

test("guest wallet accepts ownership and signs a mandate", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`browser error: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`pageerror ${error.message}`));
  await page.goto("/dev/gate-privy");
  await expect(page.locator("#status")).toHaveText("ready", { timeout: 30_000 });
  await page.click("#create-guest");
  await expect(page.locator("#wallet")).toHaveText(/^0x[0-9a-fA-F]{40}$/, { timeout: 30_000 }).catch(async () => {
    throw new Error(`status=${await page.locator("#status").textContent()} auth=${await page.locator("#auth").textContent()}`);
  });
  const guest = (await page.locator("#wallet").textContent()) ?? "";
  const handoff = cli(["gate:2", "handoff", guest]);
  const proxy = handoff.match(/proxy (0x[0-9a-fA-F]{40})/)?.[1];
  expect(proxy).toBeTruthy();
  await page.goto(`/dev/gate-privy?proxy=${proxy}`);
  await expect(page.locator("#wallet")).toHaveText(guest, { timeout: 60_000 });
  await page.click("#accept");
  await expect(page.locator("#status")).toHaveText("accepted", { timeout: 90_000 });
  await page.click("#sign");
  await expect(page.locator("#status")).toHaveText("signed", { timeout: 60_000 });
  const signature = (await page.locator("#signature").textContent()) ?? "";
  const token = (await page.locator("#token").textContent()) ?? "";
  const checked = cli(["gate:2", "check", proxy ?? "", guest, signature, token]);
  expect(checked).toContain("ownerOk=true");
  expect(checked).toContain("sigOk=true");
  expect(checked).toContain("tokenOk=true");
});
