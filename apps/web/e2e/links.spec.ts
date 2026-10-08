import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SITE } from "../lib/bounties";

const REQUIRED = ["/", "/app", "/radar", "/check", "/proof", "/twins", "/replay", "/methodology", "/developers", "/tour", "/tour/evidence"];

function pathOf(href: string, origin: string): string | null {
  if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = `${url.pathname}${url.search}`;
  if (!path.startsWith("/")) return null;
  return path;
}

async function crawl(page: Page, origin: string): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  const queue: { path: string; depth: number }[] = [{ path: "/", depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.path)) continue;
    const response = await page.goto(`${origin}${next.path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    seen.set(next.path, response?.status() ?? 0);
    if (next.depth >= 2) continue;
    const hrefs = await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      const path = pathOf(href, origin);
      if (!path || seen.has(path)) continue;
      queue.push({ path, depth: next.depth + 1 });
    }
  }
  return seen;
}

async function expectRedirect(request: APIRequestContext, origin: string, from: string, to: string) {
  const response = await request.get(`${origin}${from}`, { maxRedirects: 0 });
  expect(response.status(), from).toBe(308);
  expect(response.headers().location ?? "", from).toContain(to);
}

test.describe("link map", () => {
  test("local links stay under 400 and cover the map", async ({ page, request }) => {
    test.setTimeout(300_000);
    const origin = "http://localhost:3000";
    const seen = await crawl(page, origin);
    for (const [path, status] of seen) expect(status, path).toBeLessThan(400);
    for (const path of REQUIRED) expect([...seen.keys()].some((item) => item.split("?")[0] === path), path).toBe(true);
    expect([...seen.keys()].some((item) => item.split("?")[0]?.startsWith("/a/"))).toBe(true);
    await expectRedirect(request, origin, "/lifeline", "/app");
    await expectRedirect(request, origin, "/judges", "/tour");
  });

  test("production links stay under 400 and cover the map", async ({ page, request }) => {
    test.setTimeout(300_000);
    const seen = await crawl(page, SITE);
    for (const [path, status] of seen) expect(status, path).toBeLessThan(400);
    for (const path of REQUIRED) expect([...seen.keys()].some((item) => item.split("?")[0] === path), path).toBe(true);
    expect([...seen.keys()].some((item) => item.split("?")[0]?.startsWith("/a/"))).toBe(true);
    await expectRedirect(request, SITE, "/lifeline", "/app");
    await expectRedirect(request, SITE, "/judges", "/tour");
    const dev = await request.get(`${SITE}/dev/gate-privy`, { maxRedirects: 0 });
    expect(dev.status()).toBe(404);
  });
});
