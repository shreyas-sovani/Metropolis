/* eslint-disable no-undef -- Playwright callbacks run in the browser; the script itself runs in Node. */
import { chromium, webkit } from "@playwright/test";

const engineName = process.argv[2] === "webkit" ? "webkit" : "chrome";
const engine = engineName === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless: false,
  channel: engineName === "chrome" ? "chrome" : undefined,
  ignoreDefaultArgs: ["--enable-automation"],
  args: engineName === "chrome" ? ["--disable-blink-features=AutomationControlled"] : [],
});
const page = await browser.newPage();
let failed = "";
try {
  await page.goto("http://localhost:3000/lifeline", { waitUntil: "domcontentloaded" });
  const widget = page.getByTestId("turnstile");
  await widget.getAttribute("data-turnstile").then(async (value) => {
    if (value === "ready") return;
    await page.waitForFunction(() => document.querySelector("[data-testid=turnstile]")?.getAttribute("data-turnstile") === "ready", null, {
      timeout: 30_000,
    });
  });
  const box = await widget.boundingBox();
  if (box && box.height >= 8) failed = `visible challenge height ${box.height}`;
  const token = await page.evaluate(() => document.querySelector("input[name='cf-turnstile-response']")?.value ?? "");
  if (token.length < 10) failed = failed || "missing token";
  const accepted = await page.evaluate(async (value) => {
    const response = await fetch("/api/lifeline/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: value }),
    });
    return response.status;
  }, token);
  if (accepted !== 401) failed = failed || `fresh token status ${accepted}`;
} catch (error) {
  failed = error instanceof Error ? error.message : "check failed";
} finally {
  await browser.close();
}
const missing = await fetch("http://localhost:3000/api/lifeline/claim", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
const invalid = await fetch("http://localhost:3000/api/lifeline/claim", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ turnstileToken: "not-a-token" }),
});
if (missing.status !== 403) failed = failed || `missing status ${missing.status}`;
if (invalid.status !== 403) failed = failed || `invalid status ${invalid.status}`;
if (failed) {
  console.error(`${engineName} ${failed}`);
  process.exit(1);
}
console.log(`${engineName} invisible`);
