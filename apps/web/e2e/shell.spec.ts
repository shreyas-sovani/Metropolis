import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`home renders at ${width}px without console errors`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Where the book can break" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Radar" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
