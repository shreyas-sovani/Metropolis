import { expect, test } from "@playwright/test";

const house = {
  pairs: [
    {
      id: "btc-long",
      market: "BTC",
      side: "long",
      protected: {
        proxy: "0x36DF02ca0E9B1644e181342A795556a66eB28b10",
        mandate: "house",
        distanceE6: "27000",
        actions: [],
        outcome: "alive",
      },
      unprotected: {
        proxy: "0x0000000000000000000000000000000000000001",
        mandate: "none",
        distanceE6: "27000",
        actions: [{ txHash: "0x96442cfb", block: 4, amountCNS: "1000000" }],
        outcome: "alive",
      },
    },
  ],
};

const SANDBOX = "0x1111111111111111111111111111111111111111";
const TWIN = "0x36DF02ca0E9B1644e181342A795556a66eB28b10";

const armed = {
  txHash: "0x85fe2562",
  block: 20,
  addedCNS: "1000000",
  liqBefore: "64000000000",
  liqAfter: "61000000000",
  distBefore: "27000",
  distAfter: "60000",
  msFromRequest: 80,
};

async function sandboxRoutes(page: import("@playwright/test").Page) {
  const posted: { proxy?: string } = {};
  await page.route("**/api/lifeline/sandbox-accounts", (route) =>
    route.fulfill({ json: { accounts: [{ proxy: SANDBOX, distanceE6: "27000" }] } }),
  );
  await page.route("**/api/lifeline/sandbox", async (route) => {
    posted.proxy = (JSON.parse(route.request().postData() ?? "{}") as { proxy?: string }).proxy;
    await route.fulfill({ json: armed });
  });
  return posted;
}

test("a blocked Privy call falls through to a sandbox arm", async ({ page }) => {
  test.setTimeout(40_000);
  const posted = await sandboxRoutes(page);
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Open my practice account" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await page.route(/https:\/\/[^/]*privy\.io\//, (route) => route.abort());
  await start.click();
  await expect(page.getByTestId("sandbox")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Sign and turn on protection" }).click();
  await expect(page.getByTestId("receipt")).toContainText("Distance 2.7% → 6.0%", { timeout: 12_000 });
  expect(posted.proxy).toBe(SANDBOX);
  expect(posted.proxy).not.toBe(TWIN);
});

test("an empty pool opens sandbox", async ({ page }) => {
  const posted = await sandboxRoutes(page);
  await page.route("**/api/lifeline/claim", (route) => route.fulfill({ status: 503, json: { error: "empty", sandbox: true } }));
  await page.goto("/app?fault=pool", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Open my practice account" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await start.click();
  await expect(page.getByTestId("sandbox")).toBeVisible();
  await page.getByRole("button", { name: "Sign and turn on protection" }).click();
  await expect(page.getByTestId("receipt")).toBeVisible({ timeout: 12_000 });
  expect(posted.proxy).toBe(SANDBOX);
  expect(posted.proxy).not.toBe(TWIN);
});

test("a rate limit offers demo mode", async ({ page }) => {
  await sandboxRoutes(page);
  await page.route("**/api/lifeline/claim", (route) =>
    route.fulfill({ status: 429, json: { error: "rate" } }),
  );
  await page.goto("/app?fault=rate", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Open my practice account" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await start.click();
  await expect(page.getByText("Too many new accounts from this network")).toBeVisible();
  await expect(page.getByText("use demo mode now")).toBeVisible();
  await page.getByRole("button", { name: "Use demo mode" }).click();
  await expect(page.getByTestId("sandbox")).toBeVisible();
});

test("a turnstile rejection shows the check and retries", async ({ page }) => {
  await page.route("**/api/turnstile", (route) => route.fulfill({ json: { siteKey: "test-site" } }));
  await page.route(/challenges\.cloudflare\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.turnstile={
        render(el, opts){
          el.setAttribute("data-appearance", opts.appearance);
          const token = opts.appearance === "always" ? "token-2" : "token-1";
          setTimeout(() => opts.callback(token), opts.appearance === "always" ? 40 : 10);
          return "widget";
        },
        remove(){},
        reset(){ setTimeout(() => window.__turnstileRetry && window.__turnstileRetry(), 30); }
      };`,
    }),
  );
  await page.addInitScript(() => {
    (window as unknown as { __turnstileRetry?: () => void }).__turnstileRetry = () => undefined;
  });
  let claims = 0;
  await page.route("**/api/lifeline/claim", (route) => {
    claims += 1;
    if (claims === 1) return route.fulfill({ status: 403, json: { error: "turnstile" } });
    return route.fulfill({
      status: 200,
      json: {
        proxy: SANDBOX,
        perpId: "16",
        position: { market: "BTC", side: "long", leverage: "1500", distanceE6: "32000" },
      },
    });
  });
  await page.route(/\/api\/account\//, (route) =>
    route.fulfill({
      json: {
        found: true,
        positions: [{ symbol: "BTC", side: "long", leverage: "1500", distanceE6: "32000", freeCNS: "300000000" }],
      },
    }),
  );
  await page.goto("/app?fault=turnstile", { waitUntil: "domcontentloaded" });
  const start = page.getByRole("button", { name: "Open my practice account" });
  await expect(start).toHaveAttribute("data-ready", "yes");
  await expect(page.getByTestId("turnstile")).toHaveAttribute("data-turnstile", "ready", { timeout: 10_000 });
  await start.click();
  await expect(page.getByText("Please confirm you're human.")).toBeVisible();
  await expect(page.getByTestId("turnstile")).toHaveAttribute("data-appearance", "always");
  await expect(page.getByRole("button", { name: "Take ownership" })).toBeVisible({ timeout: 15_000 });
  expect(claims).toBe(2);
});

test("a degraded health check shows the banner", async ({ page }) => {
  await page.route("**/api/ops-health", (route) => route.fulfill({ json: { degraded: true, paused: false, rpc: false } }));
  await page.route("**/api/radar**", (route) => route.fulfill({
    json: {
      chainId: 143,
      blockNumber: "1",
      headline: { openInterestMicro: "0", atRiskNotionalMicro: "0", atRiskCount: 0, idleMicro: "0" },
      markets: [],
      positions: [],
    },
  }));
  await page.route("**/api/liquidations", (route) => route.fulfill({ json: { latest: [] } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [] } }));
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Lifeline degraded")).toBeVisible();
  await expect(page.getByText("No open positions on this chain yet.")).toBeVisible();
});

test("radar still loads when the primary RPC is dead", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/radar?rpc=dead", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-interest")).toBeVisible({ timeout: 60_000 });
});

test("twins render every pair and link each action", async ({ page }) => {
  await page.route("**/api/twins", (route) => route.fulfill({ json: house }));
  await page.route("**/api/saves", (route) => route.fulfill({ json: { count: 0 } }));
  await page.goto("/twins", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("twin-pair")).toHaveCount(1);
  const action = page.getByTestId("twin-action");
  await expect(action).toHaveAttribute("href", "https://testnet.monadexplorer.com/tx/0x96442cfb");
  await expect(action).toHaveAttribute("data-amount", "1000000");
  await expect(page.getByTestId("outcome").first()).toHaveText("Alive");
});
