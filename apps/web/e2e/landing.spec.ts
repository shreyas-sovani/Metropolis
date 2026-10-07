import { expect, test, type Page } from "@playwright/test";
import { formatBlock, formatUsd, formatUsdCompact } from "../lib/format";

const H1 = "Don't get liquidated with money in your account.";
const PRIMARY = "Protect a position.";
const LIVE_WAIT = "Live numbers are taking a moment.";

const radar = {
  chainId: 143,
  blockNumber: "111275464",
  calibrated: true,
  headline: {
    openInterestMicro: "3150000000000",
    atRiskNotionalMicro: "274500000000",
    atRiskCount: 141,
    idleMicro: "127400000000",
  },
  penalties: { paidUsd: "$12,400", avoidableUsd: "$4,100", atStakeUsd: "$800" },
  markets: [],
};

const routes = ["/", "/app", "/radar", "/check", "/proof", "/twins", "/replay", "/methodology", "/developers", "/tour", "/tour/evidence"];

async function mockLanding(page: Page) {
  await page.route(/\/api\/radar/, (route) => route.fulfill({ json: radar }));
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({
      json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: Date.now() - 1000, lastBlock: 68909760, armed: 41, poolAvailable: 8 },
    }),
  );
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0, saves: [] } }));
  await page.route(/\/api\/liquidations/, (route) => route.fulfill({ json: { latest: [] } }));
  await page.route(/\/api\/markets/, (route) => route.fulfill({ json: { markets: [] } }));
}

test("landing copy, live numbers, and routes", async ({ page }) => {
  test.setTimeout(120_000);
  const perpl: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("perpl.xyz")) perpl.push(request.url());
  });
  await mockLanding(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
  const strip = page.getByTestId("live-strip");
  await expect(strip.getByTestId("landing-open-interest")).toContainText(`${formatUsdCompact(radar.headline.openInterestMicro)} open interest`, { timeout: 30_000 });
  await expect(strip.getByTestId("landing-open-interest").locator("[title]")).toHaveAttribute("title", formatUsd(radar.headline.openInterestMicro));
  await expect(strip.getByTestId("landing-at-risk")).toContainText(`${radar.headline.atRiskCount} positions within 5%`);
  await expect(strip.getByTestId("landing-at-risk").locator("[title]")).toHaveAttribute("title", formatUsd(radar.headline.atRiskNotionalMicro));
  await expect(strip.getByTestId("landing-at-risk")).toContainText(formatUsdCompact(radar.headline.atRiskNotionalMicro));
  await expect(strip.getByTestId("landing-idle")).toContainText(`${formatUsdCompact(radar.headline.idleMicro)} idle beside them`);
  await expect(strip.getByTestId("landing-idle").locator("[title]")).toHaveAttribute("title", formatUsd(radar.headline.idleMicro));
  await expect(strip.getByTestId("landing-penalties")).toContainText(`${radar.penalties.paidUsd} penalties (30 days)`);
  await expect(strip.getByTestId("landing-block")).toHaveText(formatBlock(radar.blockNumber));
  await expect(page.getByTestId("landing-saves")).toHaveText("0");
  await expect(page.locator(".landing-hero .ui-button-primary")).toHaveCount(1);
  await expect(page.locator(".landing-hero .ui-button-primary")).toHaveText(PRIMARY);

  const hero = page.locator(".landing-hero").getByRole("link", { name: PRIMARY });
  const box = await hero.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(900);

  const hrefs = await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  for (const route of routes) {
    expect(hrefs.some((href) => href === route || href.startsWith(`${route}?`) || href.startsWith(`${route}#`))).toBe(true);
  }

  await page.getByLabel("Perpl account address").fill("not-an-address");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That isn't a valid address.")).toBeVisible();

  await page.getByLabel("Perpl account address").fill("0x77A89C51f106D6cD547542a3A83FE73cB4459135");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page).toHaveURL(/\/a\/0x77A89C51f106D6cD547542a3A83FE73cB4459135\?chain=143$/, { timeout: 30_000 });

  expect(perpl).toEqual([]);
});

test("landing screenshots and one scroll on a phone", async ({ page }) => {
  test.setTimeout(60_000);
  await mockLanding(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-open-interest")).toContainText("$3.15M", { timeout: 30_000 });
  await page.screenshot({ path: "e2e/artifacts/v4-landing-1440.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 800 });
  const hero = page.locator(".landing-hero").getByRole("link", { name: PRIMARY });
  const before = await hero.boundingBox();
  expect(before).not.toBeNull();
  expect(before?.y ?? 0).toBeLessThan(1600);
  if ((before?.y ?? 0) > 800) {
    await page.mouse.wheel(0, 800);
    await expect(hero).toBeInViewport();
  }
  await page.screenshot({ path: "e2e/artifacts/v4-landing-390.png", fullPage: true });

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
});

test("a failed radar keeps the page and says the numbers are waiting", async ({ page }) => {
  await page.route(/\/api\/radar/, (route) => route.fulfill({ status: 503, json: { error: "down" } }));
  await page.route(/\/api\/ops-health/, (route) =>
    route.fulfill({ json: { status: "normal", degraded: false, paused: false, rpc: false, lastAlarmAt: 1, lastBlock: 1, armed: 0 } }),
  );
  await page.route(/\/api\/saves/, (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(LIVE_WAIT)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
});

test("reduced motion leaves no animations after the landing loads", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockLanding(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("landing-open-interest")).toContainText("$3.15M", { timeout: 30_000 });
  await expect(page.getByTestId("landing-saves")).toHaveText("0");
  const running = await page.evaluate(() => document.getAnimations().length);
  expect(running).toBe(0);
});
